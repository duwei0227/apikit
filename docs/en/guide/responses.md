# Responses

After sending, the top of the response area shows the status, time and size, with the **Body**, **Headers** and **Test Results** tabs below. Click the arrow in the top right to collapse the response area.

## Body

| View | Description |
|------|-------------|
| **Pretty** | JSON, XML and similar formats are formatted and highlighted, with folding |
| **Raw** | The text as received |

- Click the search icon (or press `Ctrl+F` in the response) to search, with match case and regular expressions; `Ctrl+A` selects all of the response.
- The copy button copies what the current view shows.
- Large integers keep their exact value.
- For responses over 5 MB only the first 1 MB is shown; click **Copy Full Body** to copy all of it, or **Save to File…** to save it.

## Save the response

- **Send And Download** (in the dropdown next to Send): save the response as a file, with the file name and type taken from the response headers.
- **Save to Mock**: add this response to a [mock service](./mock) as a response of a route.

## Streaming responses

Responses of type `text/event-stream` (SSE), `application/x-ndjson`, `application/ndjson` or `application/jsonl` (newline-delimited JSON) are handled as streams: they are shown as they arrive, and you can click **Stop** at any time.

| View | Description |
|------|-------------|
| **Text** | The merged answer text, switchable between Rendered and Source. In Rendered: an HTML or SVG answer shows an isolated web preview (updated live, with a larger preview available), JSON or XML is formatted, and anything else is rendered as Markdown. Thinking content is shown separately as Thinking |
| **Events** | The time, event name and data of each event, with a filter |
| **Raw** | The text as received |

With **Follow output** on, the view scrolls to the latest content.

![Text view of a streaming response](/screenshots/streaming.png)

ApiKit recognizes events from these APIs and merges the answer text, thinking content, finish reason and token usage:

- OpenAI Chat Completions and compatible APIs, OpenAI Responses
- Anthropic Messages
- Gemini
- Ollama
- Custom formats: when the event name or `type` is `token`, `delta`, `chunk`, `text`, `content`, `message` or `answer` (or there is neither), the `content`, `text`, `delta` or `token` field is used

In a custom format, the text of these events is shown as the answer while it arrives. Other events that carry content may follow it, for example `event: token` for the thinking process and `event: result` and `event: fill` for the results: when the first of them arrives, the text received so far moves into Thinking, and text arriving later is Thinking too; Thinking stays expanded and shows the latest text while it keeps arriving, and folds when the stream ends. These events are the results: each is shown in Text as its own block named after the event, with its `content` or `text` as Markdown and its `data` as formatted JSON (an event with neither field is shown whole). Events without content, such as `{"type":"done","content":null,"data":null}`, only end the stream. In a stream without result events, for example with only `token` and `done`, the text stays the answer.

For streaming responses, JSON field assertions and variable extraction read the merged object:

```json
{
  "text": "The merged answer",
  "thinking": "Thinking content",
  "finishReason": "stop",
  "usage": { "prompt_tokens": 5, "completion_tokens": 3 },
  "eventCount": 12,
  "events": [],
  "results": {}
}
```

`usage` is the usage object as the API returns it, so the field names depend on the API. For example, assert `text` contains `hello`, or extract `usage.completion_tokens` into a variable.

In a custom format with result events, `text` joins the text of the result events, and `results` holds the last event of each name, for example `results.result.data.suggestAction` or `results.fill.content`.
