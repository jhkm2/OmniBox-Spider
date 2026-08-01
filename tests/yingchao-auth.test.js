const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const repoRoot = path.resolve(__dirname, "..");
const spiderSource = fs.readFileSync(
  path.join(repoRoot, "影视", "网盘", "影巢.js"),
  "utf8",
);

function loadHDHiveRequest(env) {
  const requests = [];
  const logs = [];
  const spiderModule = { exports: {} };
  const sdk = {
    deleteCache: async () => {},
    getCache: async () => null,
    log: async (level, message) => logs.push(`${level}:${message}`),
    setCache: async () => {},
  };
  const axios = async (config) => {
    requests.push(config);
    return {
      status: 200,
      headers: { "content-type": "application/json" },
      data: JSON.stringify({ success: true, data: [] }),
    };
  };
  const localRequire = (id) => {
    if (id === "omnibox_sdk") return sdk;
    if (id === "spider_runner") return { run: () => {} };
    if (id === "axios") return axios;
    return require(id);
  };
  const source = `${spiderSource}\nmodule.exports.__test = { requestHDHive };`;

  vm.runInNewContext(
    source,
    {
      module: spiderModule,
      exports: spiderModule.exports,
      require: localRequire,
      process: { env },
      URL,
      URLSearchParams,
      Buffer,
      performance,
      setTimeout,
      clearTimeout,
    },
    { filename: "影巢.js" },
  );

  return {
    logs,
    requestHDHive: spiderModule.exports.__test.requestHDHive,
    requests,
  };
}

test("HDHive sends the application key and user token together", async () => {
  const harness = loadHDHiveRequest({
    HDHIVE_API_KEY: "test-app-key",
    HDHIVE_ACCESS_TOKEN: "test-user-token",
  });

  await harness.requestHDHive("/resources/movie/550");

  assert.equal(harness.requests.length, 1);
  assert.equal(harness.requests[0].headers["X-API-Key"], "test-app-key");
  assert.equal(
    harness.requests[0].headers.Authorization,
    "Bearer test-user-token",
  );
  assert.doesNotMatch(harness.logs.join("\n"), /test-app-key|test-user-token/);
});

test("HDHive accepts a user token without an application key", async () => {
  const harness = loadHDHiveRequest({
    HDHIVE_ACCESS_TOKEN: "test-user-token",
  });

  await harness.requestHDHive("/resources/tv/1396");

  assert.equal(harness.requests.length, 1);
  assert.equal(
    Object.hasOwn(harness.requests[0].headers, "X-API-Key"),
    false,
  );
  assert.equal(
    harness.requests[0].headers.Authorization,
    "Bearer test-user-token",
  );
});

test("HDHive keeps application-key-only authentication compatible", async () => {
  const harness = loadHDHiveRequest({
    HDHIVE_API_KEY: "test-app-key",
  });

  await harness.requestHDHive("/resources/movie/550");

  assert.equal(harness.requests.length, 1);
  assert.equal(harness.requests[0].headers["X-API-Key"], "test-app-key");
  assert.equal(
    Object.hasOwn(harness.requests[0].headers, "Authorization"),
    false,
  );
});
