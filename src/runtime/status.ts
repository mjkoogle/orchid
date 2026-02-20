/**
 * StatusReporter — live terminal feedback during Orchid execution.
 *
 * Provides spinner animation + status text so the user knows what's
 * happening during long-running LLM and MCP calls.
 */

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_INTERVAL = 80; // ms

/**
 * Interface for status reporters. The interpreter and providers call
 * these methods at key moments during execution.
 */
export interface StatusReporter {
  /** Show a spinner with the given status text. */
  start(text: string): void;
  /** Update the spinner text without restarting it. */
  update(text: string): void;
  /** Stop the spinner and show a success message. */
  succeed(text: string): void;
  /** Stop the spinner and show a failure message. */
  fail(text: string): void;
  /** Stop the spinner silently. */
  stop(): void;
}

/**
 * Terminal spinner that renders to stderr so it doesn't pollute stdout.
 * Gracefully degrades in non-TTY environments (CI, piped output).
 */
export class TerminalStatusReporter implements StatusReporter {
  private frameIndex = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private currentText = '';
  private isTTY: boolean;

  constructor() {
    this.isTTY = Boolean(process.stderr.isTTY);
  }

  start(text: string): void {
    this.stop(); // clear any existing spinner
    this.currentText = text;

    if (!this.isTTY) {
      // Non-TTY: just print the status line once
      process.stderr.write(`  ◌ ${text}\n`);
      return;
    }

    this.frameIndex = 0;
    this.render();
    this.timer = setInterval(() => this.render(), SPINNER_INTERVAL);
  }

  update(text: string): void {
    this.currentText = text;
    if (!this.isTTY && this.timer === null) {
      // Non-TTY: print update as new line
      process.stderr.write(`  ◌ ${text}\n`);
    }
    // TTY: next render() tick will pick up the new text
  }

  succeed(text: string): void {
    this.clearLine();
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    process.stderr.write(`  ✔ ${text}\n`);
  }

  fail(text: string): void {
    this.clearLine();
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    process.stderr.write(`  ✖ ${text}\n`);
  }

  stop(): void {
    this.clearLine();
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private render(): void {
    const frame = SPINNER_FRAMES[this.frameIndex % SPINNER_FRAMES.length];
    this.frameIndex++;
    // \r moves to column 0, \x1b[K clears to end of line
    process.stderr.write(`\r\x1b[K  ${frame} ${this.currentText}`);
  }

  private clearLine(): void {
    if (this.isTTY) {
      process.stderr.write('\r\x1b[K');
    }
  }
}

/**
 * Silent reporter for testing or when --quiet is used.
 */
export class SilentStatusReporter implements StatusReporter {
  start(_text: string): void {}
  update(_text: string): void {}
  succeed(_text: string): void {}
  fail(_text: string): void {}
  stop(): void {}
}
