import { test } from "node:test"
import assert from "node:assert/strict"
import { shapeItem, classifyError, ERROR_STATUS } from "../src/contract.js"

test("shapeItem: item válido preserva hid/url/title/links", () => {
  const it = shapeItem({
    hid: "3ezr0",
    url: "/title/3ezr0-i-adopted",
    title: "I Adopted the Protagonist",
    altTitles: ["악역의 육아"],
    links: { al: "https://anilist.co/manga/200573/", md: null },
  })
  assert.deepEqual(it, {
    hid: "3ezr0",
    url: "/title/3ezr0-i-adopted",
    title: "I Adopted the Protagonist",
    altTitles: ["악역의 육아"],
    links: { al: "https://anilist.co/manga/200573/", md: null },
  })
})

test("shapeItem: sem hid → null", () => {
  assert.equal(shapeItem({ url: "/title/x", title: "X" }), null)
})

test("shapeItem: url ausente cai pro canônico por hid", () => {
  assert.equal(shapeItem({ hid: "abc", title: "X" })?.url, "/title/abc")
})

test("shapeItem: altTitles como objetos {title} são achatados", () => {
  const it = shapeItem({ hid: "a", url: "/t", title: "T", altTitles: [{ title: "Alt" }, "Str", { x: 1 }] })
  assert.deepEqual(it?.altTitles, ["Alt", "Str"])
})

test("shapeItem: links ausente vira {}", () => {
  assert.deepEqual(shapeItem({ hid: "a", url: "/t", title: "T" })?.links, {})
})

test("classifyError: timedOut sempre render_timeout", () => {
  assert.equal(classifyError(new Error("qualquer"), "xhr", true), "render_timeout")
})

test("classifyError: timeout na fase xhr → no_xhr", () => {
  assert.equal(classifyError(new Error("Timeout 8000ms exceeded"), "xhr", false), "no_xhr")
})

test("classifyError: timeout na navegação → render_timeout", () => {
  assert.equal(classifyError(new Error("Timeout 12000ms exceeded"), "nav", false), "render_timeout")
})

test("classifyError: target fechado → render_timeout", () => {
  assert.equal(classifyError(new Error("Target page, context or browser has been closed"), "parse", false), "render_timeout")
})

test("classifyError: desconhecido → internal", () => {
  assert.equal(classifyError(new Error("boom"), "parse", false), "internal")
})

test("ERROR_STATUS mapeia os códigos do contrato", () => {
  assert.equal(ERROR_STATUS.busy, 503)
  assert.equal(ERROR_STATUS.render_timeout, 504)
  assert.equal(ERROR_STATUS.no_xhr, 502)
  assert.equal(ERROR_STATUS.bad_request, 400)
  assert.equal(ERROR_STATUS.internal, 500)
})
