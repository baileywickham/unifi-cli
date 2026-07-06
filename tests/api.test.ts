import { test, expect } from "bun:test";
import { ApiClient, ApiError } from "../src/api";

type Call = { url: string; init: RequestInit & { tls?: { rejectUnauthorized: boolean } } };

function page(data: unknown[], totalCount = data.length, offset = 0): Response {
  return Response.json({ offset, limit: 200, count: data.length, totalCount, data });
}

function client(handler: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchFn = (url: string, init: any) => {
    const call = { url, init };
    calls.push(call);
    return Promise.resolve(handler(call));
  };
  return { api: new ApiClient("https://gw", "KEY", fetchFn as any), calls };
}

test("sends X-API-KEY header and disables TLS verification", async () => {
  const { api, calls } = client(() => Response.json({ applicationVersion: "9.1.0" }));
  await api.getInfo();
  expect(calls[0].url).toBe("https://gw/proxy/network/integration/v1/info");
  expect((calls[0].init.headers as Record<string, string>)["X-API-KEY"]).toBe("KEY");
  expect(calls[0].init.tls).toEqual({ rejectUnauthorized: false });
});

test("listDevices fetches all pages", async () => {
  const { api, calls } = client(({ url }) =>
    url.includes("offset=0")
      ? page([{ id: "a" }, { id: "b" }], 3)
      : page([{ id: "c" }], 3, 2),
  );
  const devices = await api.listDevices("s1");
  expect(devices.map((d) => d.id)).toEqual(["a", "b", "c"]);
  expect(calls.length).toBe(2);
  expect(calls[0].url).toBe("https://gw/proxy/network/integration/v1/sites/s1/devices?offset=0&limit=200");
});

test("non-2xx becomes ApiError with API message", async () => {
  const { api } = client(() => Response.json({ statusCode: 401, message: "invalid key" }, { status: 401 }));
  await expect(api.listSites()).rejects.toThrow(ApiError);
  await expect(api.listSites()).rejects.toThrow("invalid key");
});

test("404 mentions firmware support", async () => {
  const { api } = client(() => new Response("", { status: 404, statusText: "Not Found" }));
  await expect(api.getInfo()).rejects.toThrow(/firmware/);
});

test("network failure becomes friendly unreachable error", async () => {
  const { api } = client(() => {
    throw new Error("ECONNREFUSED");
  });
  await expect(api.getInfo()).rejects.toThrow(/cannot reach https:\/\/gw/);
});

test("restartDevice POSTs RESTART action", async () => {
  const { api, calls } = client(() => new Response(null, { status: 204 }));
  await api.restartDevice("s1", "d1");
  expect(calls[0].url).toBe("https://gw/proxy/network/integration/v1/sites/s1/devices/d1/actions");
  expect(calls[0].init.method).toBe("POST");
  expect(JSON.parse(calls[0].init.body as string)).toEqual({ action: "RESTART" });
});

test("powerCyclePort POSTs POWER_CYCLE to the port path", async () => {
  const { api, calls } = client(() => new Response(null, { status: 204 }));
  await api.powerCyclePort("s1", "d1", 3);
  expect(calls[0].url).toBe(
    "https://gw/proxy/network/integration/v1/sites/s1/devices/d1/interfaces/ports/3/actions",
  );
  expect(JSON.parse(calls[0].init.body as string)).toEqual({ action: "POWER_CYCLE" });
});
