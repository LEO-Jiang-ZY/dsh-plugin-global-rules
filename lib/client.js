// Client half of dsh-plugin-global-rules: one sidebar action that opens the rule
// manager **inside the application**, as a full-frame overlay.
//
// Why an overlay rather than a new tab: the desktop shell runs the GUI in the
// application window, so a `window.close()` from a page in that window closes DSH
// itself. An overlay is a plain DOM node the shell renders; dismissing it is a
// state change in this page and can never reach the window's close control.
//
// Bundle contract (see @deepseek-ai/dsh-client-modules): the host serves this
// file, the Web kernel registers `factory`, and calls it with a `require` that
// resolves the seeded platform modules (React, ReactDOM, Cordis, static UI
// libraries).
window.__ModuleLoader__.load({
  id: 'dsh-plugin-global-rules',
  factory: function (require) {
    'use strict'

    const React = require('react')

    /** The editor route served by the host half. */
    const EDITOR_PATH = '/rules'
    /** Message the embedded editor sends when it wants to be dismissed. */
    const CLOSE_MESSAGE = 'dsh-global-rules:close'

    /** Text for the action and the overlay chrome, per DSH locale. */
    const STRINGS = {
      zh: {
        action: '规则管理器',
        title: '规则管理器',
        hint: '按工作区配置不同规则；保存后下一个模型步生效。Esc 或右上角「关闭」退出。',
        close: '关闭',
      },
      en: {
        action: 'Rules',
        title: 'Rule manager',
        hint: 'Per-workspace rules. Saving takes effect on the next model step. Esc or Close dismisses.',
        close: 'Close',
      },
    }

    /** Pick a string table from the active DSH locale. */
    const stringsFor = locale => (/^en\b/i.test(String(locale ?? '')) ? STRINGS.en : STRINGS.zh)

    /**
     * Read the active DSH locale, or `undefined` when this plugin cannot see it.
     *
     * `ctx.get()` requires the service to be a declared dependency, so it can throw
     * as well as return `undefined`. Both outcomes must be survivable: the editor page
     * has its own locale detection, so losing the exact locale costs a fallback, not
     * the feature.
     *
     * @param ctx - the plugin context.
     * @returns the active locale id, when readable.
     */
    function safeLocale(ctx) {
      try {
        const snapshot = ctx?.get?.('locale')?.getLocale?.()
        return typeof snapshot?.active === 'string' ? snapshot.active : undefined
      } catch {
        return undefined
      }
    }

    /**
     * Read the live locale from the slot props, falling back to the locale captured
     * when this plugin mounted.
     *
     * @param props - the slot's props.
     * @param fallback - the locale read at mount time.
     * @returns the locale id to render with.
     */
    function readLocale(props, fallback) {
      try {
        const value = typeof props?.useLocale === 'function' ? props.useLocale() : undefined
        const active = value?.active ?? value?.id ?? value
        if (typeof active === 'string' && active.length > 0) return active
      } catch { /* a missing hook must not break the overlay */ }
      return fallback
    }

    /**
     * Build the editor URL.
     *
     * `lang` is only set when a real locale is known. Forcing a value here was a
     * defect: with the locale unreadable this plugin wrote `lang=zh`, which *outranked*
     * the page's own browser-language detection and pinned an English user to Chinese.
     * Omitting the parameter instead lets the page resolve it.
     *
     * @param locale - the active DSH locale, when known.
     * @param cwd - the session working directory, when known.
     * @returns the editor URL.
     */
    function editorUrl(locale, cwd) {
      try {
        const url = new URL(EDITOR_PATH, globalThis.location?.href ?? 'http://127.0.0.1/')
        if (typeof locale === 'string' && locale.length > 0) {
          url.searchParams.set('lang', /^en\b/i.test(locale) ? 'en' : 'zh')
        }
        url.searchParams.set('embed', '1')
        if (typeof cwd === 'string' && cwd.length > 0) url.searchParams.set('cwd', cwd)
        return url.href
      } catch {
        return EDITOR_PATH
      }
    }

    /* ── overlay chrome ──────────────────────────────────────────────────── */

    const overlayStyle = {
      position: 'fixed',
      inset: 0,
      zIndex: 2147483000,
      display: 'flex',
      flexDirection: 'column',
      background: 'light-dark(#f4f5f7, #1f2021)',
      color: 'light-dark(#0f1115, #f9fafb)',
      font: '14px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif',
    }
    const headerStyle = {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      padding: '10px 16px',
      // The desktop window owns the top-right corner; keep our chrome clear of it.
      paddingRight: '168px',
      borderBottom: '1px solid light-dark(#0000001f, #ffffff29)',
      background: 'light-dark(#ffffff, #2b2c2e)',
      WebkitAppRegion: 'no-drag',
    }
    const hintStyle = { color: 'light-dark(#61666b, #cfd3d6)', fontSize: '12px' }
    const closeStyle = {
      marginLeft: 'auto',
      font: 'inherit',
      padding: '5px 14px',
      borderRadius: '999px',
      border: '1px solid light-dark(#0000001f, #ffffff29)',
      background: 'light-dark(#f6f7f9, #353638)',
      color: 'inherit',
      cursor: 'pointer',
      WebkitAppRegion: 'no-drag',
    }
    const frameStyle = { flex: 1, width: '100%', border: 0, background: 'transparent' }
    const actionStyle = {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      width: '100%',
      padding: '6px 8px',
      border: 0,
      borderRadius: '8px',
      background: 'transparent',
      color: 'inherit',
      font: 'inherit',
      cursor: 'pointer',
      textAlign: 'left',
    }

    /**
     * The DSH locale captured when this plugin mounted.
     *
     * `undefined` rather than a hardcoded language on purpose: the editor page then
     * falls back to the browser/Electron UI language, which is what the user actually
     * sees, instead of to a guess made here.
     */
    let mountLocale

    /**
     * The sidebar action plus the overlay it opens. Renders only the action until
     * the user opens the manager.
     */
    function RuleManagerOverlay(props = {}) {
      // The locale is read on every render, so switching DSH's language mid-session
      // relabels the button and reopens the editor in the new language.
      const activeLocale = readLocale(props, mountLocale)
      const text = stringsFor(activeLocale)
      const cwd = props.cwd ?? props.workspacePath
      const [open, setOpen] = React.useState(false)
      const [nonce, setNonce] = React.useState(0)

      const close = React.useCallback(() => setOpen(false), [])

      React.useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') close()
        }
        const onMessage = (event) => {
          // Same-origin only: the editor is served by this very origin.
          if (event?.origin !== globalThis.location?.origin) return
          if (event?.data?.type === CLOSE_MESSAGE) close()
        }
        globalThis.addEventListener?.('keydown', onKey)
        globalThis.addEventListener?.('message', onMessage)
        return () => {
          globalThis.removeEventListener?.('keydown', onKey)
          globalThis.removeEventListener?.('message', onMessage)
        }
      }, [close])

      const openEditor = React.useCallback(() => {
        setNonce(value => value + 1)
        setOpen(true)
      }, [])

      const action = React.createElement('button', {
        type: 'button',
        className: 'dsh-global-rules-action',
        'aria-label': text.action,
        title: text.action,
        onClick: openEditor,
        style: actionStyle,
      }, [
        React.createElement('span', { key: 'icon', 'aria-hidden': 'true', style: { fontSize: '13px' } }, '📋'),
        React.createElement('span', { key: 'label' }, text.action),
      ])

      const overlay = open
        ? React.createElement('div', {
          style: overlayStyle,
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': text.title,
        }, [
          React.createElement('div', { key: 'head', style: headerStyle }, [
            React.createElement('strong', { key: 'title' }, text.title),
            React.createElement('span', { key: 'hint', style: hintStyle }, text.hint),
            React.createElement('button', { key: 'close', type: 'button', style: closeStyle, onClick: close }, text.close),
          ]),
          React.createElement('iframe', {
            key: `frame-${nonce}`,
            title: text.title,
            src: editorUrl(activeLocale, cwd),
            style: frameStyle,
          }),
        ])
        : null

      return React.createElement(React.Fragment, null, action, overlay)
    }

    return {
      name: 'global-rules',
      inject: ['slots'],
      apply(ctx) {
        // Expose the contract so a command or another plugin can drive it too.
        ctx.provide('globalRulesOverlay', { path: EDITOR_PATH, message: CLOSE_MESSAGE })
        // No hardcoded language: an unreadable locale stays `undefined` so the editor
        // resolves the language itself instead of inheriting a wrong guess.
        mountLocale = safeLocale(ctx)
        const initialLocale = mountLocale ?? globalThis.navigator?.language
        ctx.effect(() => ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'global-rules',
          order: 20,
          label: stringsFor(initialLocale).action,
        }, RuleManagerOverlay)), 'global-rules.sidebar-action()')
      },
    }
  },
})
