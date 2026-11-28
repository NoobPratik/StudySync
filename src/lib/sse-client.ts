export async function readSseStream<
  TMeta = Record<string, unknown>,
  TDone = Record<string, unknown>,
>(
  res: Response,
  handlers: {
    onMeta?: (data: TMeta) => void;
    onThinking?: (text: string) => void;
    onToken?: (text: string) => void;
    onDone?: (data: TDone) => void;
    onError?: (message: string) => void;
    onEvent?: (eventName: string, data: Record<string, unknown>) => void;
  },
): Promise<void> {
  if (!res.body) {
    throw new Error("Streaming response body missing");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() || "";

    for (const frame of frames) {
      let eventName = "message";
      let dataStr = "";
      for (const line of frame.split(/\r?\n/)) {
        if (line.startsWith("event:")) {
          eventName = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          dataStr += line.slice(5).trim();
        }
      }
      if (!dataStr) continue;

      try {
        const parsed = JSON.parse(dataStr);
        if (eventName === "meta") handlers.onMeta?.(parsed as TMeta);
        else if (eventName === "thinking") handlers.onThinking?.(parsed.text || "");
        else if (eventName === "token") handlers.onToken?.(parsed.text || "");
        else if (eventName === "done") handlers.onDone?.(parsed as TDone);
        else if (eventName === "error") {
          const msg = parsed.error || "Stream failed";
          handlers.onError?.(msg);
          throw new Error(msg);
        } else {
          handlers.onEvent?.(eventName, parsed as Record<string, unknown>);
        }
      } catch (e) {
        if (eventName === "error") throw e;
      }
    }
  }
}
