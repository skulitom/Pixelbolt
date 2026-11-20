// A spawned command's JSON reply, parsed. When the stream holds anything else, the error says how the process ended and
// what it wrote on both streams, so a failure seen only on one runner (P-186: a second line after the reply on stderr,
// or no reply at all) names what was there instead of only where JSON.parse stopped.
export function cliReply(result, stream = 'stdout') {
  try {
    return JSON.parse(result[stream]);
  } catch (error) {
    const shown = text => JSON.stringify(String(text ?? '').slice(0, 4000));
    const ended = `status ${result.status}${result.signal ? `, signal ${result.signal}` : ''}${result.error ? `, ${result.error.message}` : ''}`;
    throw new Error(`${error.message} in the command's ${stream} (it ended with ${ended}); stdout ${shown(result.stdout)}, stderr ${shown(result.stderr)}`, { cause: error });
  }
}
