import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Runs a command and resolves with its stdout; rejects on non-zero exit. */
export type CommandRunner = (command: string, args: string[]) => Promise<string>;

export const runCommand: CommandRunner = async (command, args) => {
  try {
    const { stdout } = await execFileAsync(command, args, { maxBuffer: 256 * 1024 * 1024 });
    return stdout;
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string };
    if (e.code === 'ENOENT') {
      throw new Error(
        `"${command}" not found. Install osxphotos (e.g. \`uv tool install osxphotos\`) or set PHOTO_FILTER_OSXPHOTOS.`,
      );
    }
    const detail = e.stderr?.trim() || e.message;
    throw new Error(`${command} ${args[0] ?? ''} failed: ${detail}`);
  }
};

/**
 * The osxphotos invocation, e.g. `osxphotos` or `uvx osxphotos`. Read from
 * `PHOTO_FILTER_OSXPHOTOS` (whitespace-separated) so users can point at any install.
 */
export function osxphotosCommand(env: NodeJS.ProcessEnv = process.env): string[] {
  const parts = (env.PHOTO_FILTER_OSXPHOTOS ?? 'osxphotos').trim().split(/\s+/);
  return parts.length && parts[0] ? parts : ['osxphotos'];
}
