# Making a bonaparte plugin

A plugin adds tools for the agent, "/" commands for the person, and views beside the conversation.
It is a folder with a manifest (plugin.json) and a Node half (index.mjs), and optionally a view (an HTML page).

## The manifest

- id: a plain name, lowercase letters, digits and dashes ("changelog").
- name, version, description: shown to the person ({ "en": "...", "fr": "..." } or a plain English string).
- effects: what it will be able to do, said before it runs: a list of { "effect", "what" }, the effect one of
  read, write, execute, network. A tool may only have an effect its plugin declares.
- contributes.tools: { "name", "description" (English, for the model), "effect", "inputSchema" (JSON Schema) }.
  The agent sees each one as plugin__<id>__<name>.
- contributes.commands: { "name", "description" }: a "/" command; run, it calls the command of that name.
- contributes.panes: { "id", "title" }: a pane beside the conversation, drawn by the view.
- entry.view: the HTML page of the view, if any. entry.node is index.mjs for a plugin made in a conversation.

## The Node half (index.mjs)

An ES module whose default export has activate(ctx). It runs in a process of its own: it bundles what it needs
(no npm install runs for it). Everything it does for the agent goes through its context:

- ctx.registerToolHandler(name, async (call) => ({ content })): call.input is the model's input;
  call.use(tool, input) runs one of the core's own tools (read_file, list_files, search, edit_file,
  write_file, run_command, web_fetch) in the conversation's folders, within the tool's declared effect, and
  judged as the agent's own calls (asked in the person's mode). A refusal is a result, never an exception.
- ctx.registerCommand(name, (payload) => result): for a "/" command, return { send: "text" } to send a
  message in the person's name, or { notify: "text" } to say something beside the composer.
- ctx.getConfig(key), ctx.log(text), ctx.emit(event, payload) for its view, ctx.onDispose(fn).

Example:

    export default {
      activate(ctx) {
        ctx.registerCommand("changelog", () => ({ send: "Sum up the commits of the day." }));
        ctx.registerToolHandler("today", async (call) => {
          const log = await call.use("run_command", { program: "git", args: ["log", "--since=midnight", "--oneline"] });
          return { content: log.content };
        });
      },
    };

## The view

A page served in a sandboxed frame: no access to the app, only to its plugin. It talks by window messages
(the SDK's defineView and connectView do it): { channel: "bonaparte-view", type: "invoke", id, command, payload }
answered by { type: "reply", id, ok, value | error }; it hears { type: "event" } and { type: "theme" }. The
app's stylesheet is at /@bonaparte/kit.css.

## Making one in a conversation

1. harness_inspect: what is there already, and this guide.
2. extension_define with the manifest and the code: it is compiled, never run; a refusal says what to fix.
   Each definition is a new revision: nothing is overwritten.
3. extension_run: the person sees the code and says yes before anything runs. Its tools and commands reach
   this conversation from your next message.
4. extension_stop ends the trial; extension_undefine removes it. The person installs it from its card.
