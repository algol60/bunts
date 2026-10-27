import { Plugin } from "@opencode/plugin/tui"
import { createSignal } from "solid-js"

export default Plugin.define({
  id: "rename2.tui",
  setup(context) {
    // Latest title reported by rename events, used until the session cache catches up.
    const [renamedTitles, setRenamedTitles] = createSignal<Record<string, string>>({})
    // Session last viewed, so the home footer can describe it.
    const [viewedSessionID, setViewedSessionID] = createSignal<string>()

    const stopRenamed = context.data.on("session.renamed", (event) => {
      setRenamedTitles((current) => ({
        ...current,
        [event.data.sessionID]: event.data.title,
      }))
    })

    const stopViewed = context.data.on("session.viewed", (event) => {
      setViewedSessionID(event.data.sessionID)
    })

    // Reactive: the routed session, the active tab, or the last viewed session on the home screen.
    const currentSessionID = () => {
      const route = context.ui.router.current()
      if (route.type === "session") return route.sessionID
      if (context.ui.tabs.enabled()) {
        const active = context.ui.tabs.list().find((tab) => tab.active)
        if (active) return active.sessionID
      }
      return viewedSessionID()
    }

    const title = (sessionID?: string) => {
      const id = sessionID ?? currentSessionID()
      if (!id) return ""
      return context.data.session.get(id)?.title ?? renamedTitles()[id] ?? ""
    }

    const unregisterPrompt = context.ui.slot({
      prepend: "prompt.footer.status",
      render: ({ sessionID }) => <text fg="red">{title(sessionID)}</text>,
    })

    const unregisterHome = context.ui.slot({
      append: "home.footer.status",
      render: () => <text fg="red">{title()}</text>,
    })

    return () => {
      stopRenamed()
      stopViewed()
      unregisterPrompt()
      unregisterHome()
    }
  },
})
