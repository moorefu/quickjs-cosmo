# Terminal interfaces and acceptance

This extension follows the locked Node 24.21.0 API subset and the existing Cosmopolitan terminal backend. The baseline is commit `60b4808b23ee202f366a5d60ac967302781ff1a1`, [successful seven-platform CI 40800354481](https://github.com/moorefu/quickjs-cosmo/actions/runs/40800354481). The downloaded release artifact 12866322003 has SHA-256 `f7a2288c981fbbfeeadd53d46cd79bf3414ea437c90f3a069fd9ee2964792d5b`; its qjs SHA-256 is `deebb655078e1116a540a27dc4dff6a482fc18ff692f7b7ccdb2ba3ca8614c1a`. The baseline leaves nested legacy raw mode enabled on exit from the paired-call probe; the new native supervisor asserts exact restoration. the historical issue's missing process stdio was already resolved by M6.

## TTY-01: native mode ownership

`os.ttySetRaw(fd, enabled = true)` preserves the one-argument legacy call and adds paired release. Legacy acquisitions nest, up to 32 levels per Context/descriptor. Each false releases one level. Node `ReadStream.setRawMode(boolean)` is idempotent per stream. Native leases from different streams/contexts share the original terminal snapshot; the last owner restores it. At most 16 terminal devices and 64 owners coexist in a process. A retained descriptor prevents restoration through a closed/reused fd.

Legacy mode preserves its existing ISIG behavior. Node raw mode disables signal-character interpretation, so Ctrl-C arrives as a key. Unix termios and exact Windows input/output console modes are saved. Explicit release, stream destruction, Context/Runtime shutdown, normal/explicit exit and default SIGINT/SIGTERM/SIGHUP/SIGQUIT/SIGABRT/SIGUSR1/SIGUSR2/SIGALRM restore owned modes. SIGKILL cannot run cleanup. User signal callbacks remain in control; resetting a callback to default while raw is active retains the restoration guard. Workers cannot acquire raw mode or read through Node shared stdin. Legacy os.read retains QuickJS descriptor-sharing semantics. Runtime/Context opaque remain owned by their existing users.

The runtime owns terminal modes. Applications own ANSI display changes. The sample encloses its alternate-screen/cursor/style changes in cleanup paths, including its registered signal handlers. Raw-mode operations do not inject display escapes into arbitrary applications.

## TTY-02: size and stdio

`os.ttyGetWinSize(fd)` returns `[columns, rows]` for positive dimensions, otherwise null. Unix `os.SIGWINCH` is exported; Windows applications use size queries/resize events. `process.stdin` is a tty.ReadStream when attached to a terminal; stdout/stderr are tty.WriteStream instances. Pipe/file streams retain their existing Readable/Writable behavior and do not receive raw methods or fabricated dimensions.

`node:tty` exports `isatty`, `ReadStream` and `WriteStream`. This first subset constructs stdin (fd 0) and stdout/stderr (fd 1/2), and preserves the existing one-reader-per-process policy. WriteStream exposes columns, rows, getWindowSize and resize. Resize listeners use a 100 ms unreferenced poll, removed with the last listener; they do not keep an otherwise idle runtime alive. Live Node APIs are independently compared against the pinned oracle.

## TTY-03: readline

`node:readline` and `node:readline/promises` provide createInterface/Interface, line and close events, callback/promise question with AbortSignal, pause/resume/close, async line iteration, prompt/getPrompt/setPrompt/write, and cursorTo/moveCursor/clearLine/clearScreenDown. Cursor helpers accept integer coordinates; cursorTo requires nonnegative positions. emitKeypressEvents decodes split UTF-8 and escape sequences, arrows, Home/End/Delete, F1–F12, Enter, Tab, Backspace, Escape and Ctrl-C/D. Editing supports arrows/history, Home/End/Delete/Backspace, Enter and Ctrl-A/E/U/K/W/C/D. Terminal editing and cursor arithmetic cover ASCII; grapheme widths, mouse, full completion and TUI layout remain outside this subset.

Nonterminal interfaces split CR/LF/CRLF incrementally, emit the final unterminated line at EOF and generate no automatic ANSI. Explicit cursor helper calls write the requested ANSI bytes, as Node does. Terminal interfaces restore the input's previous raw setting on close; one terminal interface may own an input at a time. Line buffers are bounded at 64 KiB characters, history at 1000 entries, escape sequences at 64 characters and async iterator buffering at 64 lines. Pending questions have one owner; concurrent questions fail clearly. Closing a pending promise question rejects it with ERR_USE_AFTER_CLOSE; this is an explicit lifetime policy of the declared subset.

## TTY-04: legacy I/O and sample

The legacy read signature is `os.read(fd, arrayBuffer, byteOffset, byteLength)`. A read handler must handle zero as EOF, remove itself with `os.setReadHandler(fd, null)` and remove its own terminal leases. `os.read(fd, size)` is invalid. The sample gates terminal behavior on isTTY and uses plain output for pipes.

## TTY-05 and TTY-06: executable evidence

Run real Unix PTYs and Windows ConPTY; pipe mocks cannot count as terminal acceptance. Source, qjsc and hand-linked SDK use the same cases. Keep a terminal descriptor/control process alive after the child exits and compare native modes before/after, so kernel last-close resets cannot conceal leaks. Exercise nested/idempotent release, character/arrow/function/Enter/Escape/Ctrl-C input, resize, explicit/exception/default-signal exit, Worker restrictions and repeated sessions. Save raw input/output and machine-readable results per host. Check the sample's owned ANSI state before closing ConPTY, and check the pipe path has no automatic escapes or pending readers. Seven matching platform records and the CI gate are required before completion.

References: [Node 24.21 TTY](https://nodejs.org/download/release/v24.21.0/docs/api/tty.html), [Node 24.21 readline](https://nodejs.org/download/release/v24.21.0/docs/api/readline.html), [Microsoft ConPTY session lifecycle](https://learn.microsoft.com/en-us/windows/console/creating-a-pseudoconsole-session), [ResizePseudoConsole](https://learn.microsoft.com/en-us/windows/console/resizepseudoconsole).

Run `python scripts/test_terminal.py --qjs dist/qjs.exe --compiled build/test-linux/terminal-standalone.exe --sdk build/test-linux/terminal-sdk.exe` after the compiled suite prepares both programs. `build/terminal/<system>/` contains raw input/output and JSON results. ConPTY normalizes VT output, so its active buffer, attributes and cursor visibility are queried natively before teardown. The driver clears inherited redirected std handles with STARTF_USESTDHANDLES, as described by [Microsoft Terminal maintainers](https://github.com/microsoft/terminal/discussions/15814).

Legacy read example:

```js
const bytes = new Uint8Array(4096);
os.setReadHandler(0, () => {
    const count = os.read(0, bytes.buffer, 0, bytes.length);
    if (count === 0) { os.setReadHandler(0, null); return; }
    if (count > 0) consume(bytes.subarray(0, count));
});
```

A local negative control deliberately leaves the alternate screen, inverse style and hidden cursor active. The still-attached native ConPTY supervisor rejects it (`DISPLAY [0]`, nonzero exit), demonstrating that client/ConPTY teardown cannot supply a false cleanup pass. Positive sample cases cover normal, exception, explicit exit and handled signal cleanup.

Immediate exception/explicit-exit cases need no injected input. ConPTY may coalesce away their transient READY frame, so their acceptance uses the final exit result and native post-exit mode/display snapshot. Interactive and signal-driven cases still wait for READY before sending keys or signals.

The Windows SDK sample case configures a VT-disabled output mode before acquiring any raw lease. Display cleanup must run before releasing the last raw owner, since that release restores the original output mode. Its native before/after snapshots must match with VT still disabled. Ordinary sample execution omits the test-only READY marker.
