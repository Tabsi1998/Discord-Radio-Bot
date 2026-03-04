import test from "node:test";
import assert from "node:assert/strict";

import { getDashboardRepeatLabel, renderDiscordMarkdown } from "../frontend/src/lib/dashboardEvents.js";

test("renderDiscordMarkdown keeps HTML escaped but renders Discord custom emojis", () => {
  const html = renderDiscordMarkdown(
    "**Start** <:partyblob:123456789012345678> <a:danceblob:987654321098765432> <script>alert(1)</script>"
  );

  assert.match(html, /<strong>Start<\/strong>/);
  assert.match(html, /cdn\.discordapp\.com\/emojis\/123456789012345678\.webp/);
  assert.match(html, /cdn\.discordapp\.com\/emojis\/987654321098765432\.gif/);
  assert.doesNotMatch(html, /&lt;:partyblob:123456789012345678&gt;/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test("renderDiscordMarkdown resolves :name: aliases with server emojis", () => {
  const html = renderDiscordMarkdown(
    "**Start** :partyblob: :danceblob:",
    {
      serverEmojis: [
        { id: "123456789012345678", name: "partyblob", animated: false },
        { id: "987654321098765432", name: "danceblob", animated: true },
      ],
    }
  );

  assert.match(html, /cdn\.discordapp\.com\/emojis\/123456789012345678\.webp/);
  assert.match(html, /cdn\.discordapp\.com\/emojis\/987654321098765432\.gif/);
  assert.doesNotMatch(html, /&lt;:partyblob:&gt;/);
  assert.doesNotMatch(html, /&lt;:danceblob:&gt;/);
});

test("getDashboardRepeatLabel mirrors Discord-style recurrence labels", () => {
  assert.equal(getDashboardRepeatLabel("weekly", "de", { startsAt: "2026-03-06T22:00" }), "Jeden Freitag");
  assert.equal(getDashboardRepeatLabel("yearly", "de", { startsAt: "2026-03-06T22:00" }), "Jährlich am 6. März");
});
