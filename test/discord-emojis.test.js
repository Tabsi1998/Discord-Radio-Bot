import test from "node:test";
import assert from "node:assert/strict";

import { expandDiscordEmojiAliases } from "../src/lib/discord-emojis.js";

test("expandDiscordEmojiAliases converts :name: aliases to Discord custom emoji tokens", () => {
  const result = expandDiscordEmojiAliases(
    "Start :partyblob: and :danceblob:",
    [
      { id: "123456789012345678", name: "partyblob", animated: false },
      { id: "987654321098765432", name: "danceblob", animated: true },
    ]
  );

  assert.equal(
    result,
    "Start <:partyblob:123456789012345678> and <a:danceblob:987654321098765432>"
  );
});

test("expandDiscordEmojiAliases preserves already expanded Discord emoji tokens", () => {
  const result = expandDiscordEmojiAliases(
    "Ready <:partyblob:123456789012345678> :danceblob:",
    [
      { id: "123456789012345678", name: "partyblob", animated: false },
      { id: "987654321098765432", name: "danceblob", animated: true },
    ]
  );

  assert.equal(
    result,
    "Ready <:partyblob:123456789012345678> <a:danceblob:987654321098765432>"
  );
});
