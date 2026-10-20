import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  buildEnvelope,
  buildParameters,
  childNode,
  childText,
  childrenOf,
  escapeXml,
  parseOperationResponse,
  tagOf,
  textOf,
} from "../src/index.js";

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

describe("escapeXml", () => {
  it("escapes the five XML entities", () => {
    expect(escapeXml(`a&b<c>d"e'f`)).toBe("a&amp;b&lt;c&gt;d&quot;e&apos;f");
  });

  it("leaves plain text untouched", () => {
    expect(escapeXml("DEVT04D001|E")).toBe("DEVT04D001|E");
  });
});

describe("buildParameters", () => {
  it("wraps values in PARAMETERS/PARAM and escapes them", () => {
    expect(buildParameters(["a&b", 1, true])).toBe(
      "<PARAMETERS><PARAM>a&amp;b</PARAM><PARAM>1</PARAM><PARAM>true</PARAM></PARAMETERS>",
    );
  });
});

describe("buildEnvelope", () => {
  it("builds an rpc/encoded login envelope with the v2 argument order", () => {
    const xml = buildEnvelope("login", [
      { name: "Client", type: "string", value: "00" },
      { name: "DBServer", type: "string", value: "DBS" },
      { name: "DBName", type: "string", value: "DB" },
      { name: "Compression", type: "boolean", value: false },
    ]);

    expect(xml).toContain("<web:login>");
    expect(xml).toContain('<Client xsi:type="xsd:string">00</Client>');
    expect(xml).toContain('<DBServer xsi:type="xsd:string">DBS</DBServer>');
    expect(xml).toContain('<DBName xsi:type="xsd:string">DB</DBName>');
    expect(xml).toContain('<Compression xsi:type="xsd:boolean">false</Compression>');
    expect(xml).toContain('soapenv:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"');
  });
});

describe("parseOperationResponse", () => {
  it("resolves an AXIS multiRef login response", () => {
    const parsed = parseOperationResponse(fixture("login-success.xml"), "login");

    expect(parsed.fault).toBeNull();
    const node = parsed.returnNode;
    expect(node).not.toBeNull();
    if (!node) throw new Error("loginReturn missing");

    expect(childText(node, "SessionId")).toBe("SESSION-123");
    expect(childText(node, "SecurityKey")).toBe("SECURITY-456");
    expect(childText(node, "Success")).toBe("true");
    expect(childText(node, "ContactNum")).toBe("42");
  });

  it("parses an inline login failure", () => {
    const parsed = parseOperationResponse(fixture("login-failure.xml"), "login");

    expect(parsed.fault).toBeNull();
    const node = parsed.returnNode;
    if (!node) throw new Error("loginReturn missing");

    expect(childText(node, "Success")).toBe("false");
    expect(childText(node, "ErrorMessage")).toBe("login error: 2");
  });

  it("resolves nested multiRefs in a callService response", () => {
    const parsed = parseOperationResponse(fixture("call-success.xml"), "callService");

    expect(parsed.fault).toBeNull();
    const node = parsed.returnNode;
    if (!node) throw new Error("callServiceReturn missing");

    expect(childText(node, "SYSStatus")).toBe("0");
    expect(childText(node, "RequestId")).toBe("7");

    const response = childNode(node, "Response");
    const value = response ? childNode(response, "Value") : null;
    expect(value ? textOf(value) : "").toBe("<RESULT>OK</RESULT>");

    const messages = childNode(node, "Messages");
    const messagesValue = messages ? childNode(messages, "Value") : null;
    expect(messagesValue ? textOf(messagesValue) : "").toBe("Islem tamamlandi");

    const extra = childNode(node, "ExtraVariables");
    const extraValue = extra ? childNode(extra, "Value") : null;
    expect(extraValue ? textOf(extraValue) : "").toBe("client=00");
  });

  it("parses an inline callService response", () => {
    const parsed = parseOperationResponse(fixture("call-inline.xml"), "callService");
    const node = parsed.returnNode;
    if (!node) throw new Error("callServiceReturn missing");

    expect(childText(node, "SYSStatus")).toBe("0");
    expect(childText(node, "RequestId")).toBe("3");
  });

  it("parses a SOAP fault", () => {
    const parsed = parseOperationResponse(fixture("fault.xml"), "callService");

    expect(parsed.returnNode).toBeNull();
    expect(parsed.fault?.code).toBe("soapenv:Server.userException");
    expect(parsed.fault?.message).toBe("Session not found");
  });

  it("parses the listServices array", () => {
    const parsed = parseOperationResponse(fixture("list-services.xml"), "listServices");
    const node = parsed.returnNode;
    if (!node) throw new Error("listServicesReturn missing");

    const items = childrenOf(node)
      .filter((child) => tagOf(child) === "item")
      .map((child) => textOf(child));

    expect(items).toEqual(["ERCCONVERTSAVE_ERCCONVERTWS", "ERCPING_ERCCONVERTWS"]);
  });

  it("throws on a non-XML body", () => {
    expect(() => parseOperationResponse("<html>oops", "login")).toThrow();
  });
});
