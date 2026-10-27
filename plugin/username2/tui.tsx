import { userInfo } from "node:os"
import { Plugin } from "@opencode/plugin/tui"

export default Plugin.define({
  id: "username2.tui",
  setup(context) {
    const username = userInfo().username

    return context.ui.slot({
      prepend: "prompt.footer.status",
      render: () => <text>The current user's user name is {username}</text>,
    })
  },
})
