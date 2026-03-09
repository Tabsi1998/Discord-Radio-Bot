import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeDashboardCustomStation,
  listDashboardCustomStationFolders,
  filterDashboardCustomStations,
  groupDashboardCustomStations,
} from "../frontend/src/lib/dashboardCustomStations.js";

test("dashboard custom station helpers normalize folder and tags", () => {
  const station = normalizeDashboardCustomStation({
    key: "nightwave",
    name: "Nightwave FM",
    url: "https://example.com/live",
    genre: "Synthwave",
    folder: "Night",
    tags: ["Night", "Synth", "night", ""],
  });

  assert.deepEqual(station, {
    key: "nightwave",
    name: "Nightwave FM",
    url: "https://example.com/live",
    genre: "Synthwave",
    folder: "Night",
    tags: ["Night", "Synth"],
  });
});

test("dashboard custom station helpers list folders, filter, and group deterministically", () => {
  const stations = [
    { key: "late", name: "Late FM", folder: "Night", tags: ["chill"], url: "https://a.example/live", genre: "Chill" },
    { key: "drive", name: "Drive FM", folder: "Night", tags: ["retro"], url: "https://b.example/live", genre: "Synth" },
    { key: "news", name: "News Radio", folder: "", tags: ["talk"], url: "https://c.example/live", genre: "Talk" },
  ];

  assert.deepEqual(listDashboardCustomStationFolders(stations), ["Night"]);

  const filtered = filterDashboardCustomStations(stations, { search: "retro", folder: "Night" });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].key, "drive");

  const grouped = groupDashboardCustomStations(filterDashboardCustomStations(stations));
  assert.equal(grouped.length, 2);
  assert.equal(grouped[0].folder, "");
  assert.deepEqual(grouped[0].stations.map((station) => station.key), ["news"]);
  assert.equal(grouped[1].folder, "Night");
  assert.deepEqual(grouped[1].stations.map((station) => station.key), ["drive", "late"]);
});
