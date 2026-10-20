import { XMLParser } from "fast-xml-parser";

import { CaniasProtocolError } from "./errors.js";
import type { CaniasParamValue } from "./types.js";

/** Namespace used by the CANIAS Web Service 2.0 body elements. */
export const CANIAS_NAMESPACE = "http://webservice.ias.com";

const SOAP_NAMESPACE = "http://schemas.xmlsoap.org/soap/envelope/";
const XSI_NAMESPACE = "http://www.w3.org/2001/XMLSchema-instance";
const XSD_NAMESPACE = "http://www.w3.org/2001/XMLSchema";
const SOAP_ENCODING = "http://schemas.xmlsoap.org/soap/encoding/";

export type XmlParamType = "string" | "boolean" | "int";

export interface XmlParam {
  name: string;
  type: XmlParamType;
  value: string | number | boolean;
}

/** A node produced by fast-xml-parser with `preserveOrder: true`. */
export interface XmlNode {
  [key: string]: unknown;
  ":@"?: Record<string, string>;
}

export interface SoapFault {
  code: string;
  message: string;
}

export interface ParsedOperation {
  /** `null` when the body is not a fault. */
  fault: SoapFault | null;
  /** `loginReturn`, `callServiceReturn`, `listServicesReturn`, ... */
  returnNode: XmlNode | null;
}

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  ignoreDeclaration: true,
  ignorePiTags: true,
});

const XML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

/** Escapes a value for use inside XML text or an attribute. */
export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => XML_ESCAPES[char] ?? char);
}

/**
 * Builds the `<PARAMETERS><PARAM>...</PARAM></PARAMETERS>` payload that
 * `callService` expects.
 */
export function buildParameters(values: readonly CaniasParamValue[]): string {
  const params = values
    .map((value) => `<PARAM>${escapeXml(String(value))}</PARAM>`)
    .join("");
  return `<PARAMETERS>${params}</PARAMETERS>`;
}

/** Builds a complete SOAP 1.1 envelope for an AXIS rpc/encoded operation. */
export function buildEnvelope(
  operation: string,
  params: readonly XmlParam[],
): string {
  const body = params
    .map((param) => {
      const type =
        param.type === "int"
          ? "xsd:int"
          : param.type === "boolean"
            ? "xsd:boolean"
            : "xsd:string";
      return `<${param.name} xsi:type="${type}">${escapeXml(
        String(param.value),
      )}</${param.name}>`;
    })
    .join("");

  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<soapenv:Envelope xmlns:soapenv="${SOAP_NAMESPACE}"` +
    ` xmlns:xsi="${XSI_NAMESPACE}"` +
    ` xmlns:xsd="${XSD_NAMESPACE}"` +
    ` xmlns:web="${CANIAS_NAMESPACE}">` +
    "<soapenv:Header/>" +
    `<soapenv:Body soapenv:encodingStyle="${SOAP_ENCODING}">` +
    `<web:${operation}>${body}</web:${operation}>` +
    "</soapenv:Body>" +
    "</soapenv:Envelope>"
  );
}

/** Returns the element tag of a node, or `undefined` for text/PI nodes. */
export function tagOf(node: XmlNode): string | undefined {
  for (const key of Object.keys(node)) {
    if (key !== ":@") return key;
  }
  return undefined;
}

/** Attributes of a node, with the `@_` prefix removed. */
export function attrsOf(node: XmlNode): Record<string, string> {
  const raw = node[":@"];
  if (!raw || typeof raw !== "object") return {};

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    out[key.startsWith("@_") ? key.slice(2) : key] = String(value);
  }
  return out;
}

/** Child nodes of an element node. */
export function childrenOf(node: XmlNode): XmlNode[] {
  const tag = tagOf(node);
  if (!tag) return [];
  const value = node[tag];
  return Array.isArray(value) ? (value as XmlNode[]) : [];
}

/** Concatenated direct text of an element (for example `<Value>abc</Value>`). */
export function textOf(node: XmlNode): string {
  let out = "";
  for (const child of childrenOf(node)) {
    if (tagOf(child) !== "#text") continue;
    const value = child["#text"];
    out += typeof value === "string" ? value : String(value ?? "");
  }
  return out;
}

function localName(tag: string): string {
  const index = tag.indexOf(":");
  return index >= 0 ? tag.slice(index + 1) : tag;
}

function isElement(node: XmlNode): boolean {
  const tag = tagOf(node);
  return tag !== undefined && !tag.startsWith("#") && !tag.startsWith("?");
}

/** First direct child with the given local name. */
export function findChild(
  nodes: readonly XmlNode[],
  name: string,
): XmlNode | undefined {
  for (const node of nodes) {
    const tag = tagOf(node);
    if (!tag || !isElement(node)) continue;
    if (localName(tag) === name) return node;
  }
  return undefined;
}

/** Text of the first direct child with the given local name. */
export function childText(node: XmlNode, name: string): string {
  const child = findChild(childrenOf(node), name);
  return child ? textOf(child) : "";
}

/** First direct child element with the given local name. */
export function childNode(node: XmlNode, name: string): XmlNode | null {
  return findChild(childrenOf(node), name) ?? null;
}

function collectRefs(
  nodes: readonly XmlNode[],
  refs: Map<string, XmlNode>,
  depth = 0,
): void {
  if (depth > 64) return;
  for (const node of nodes) {
    if (!isElement(node)) continue;
    const id = attrsOf(node)["id"];
    if (id) refs.set(id, node);
    collectRefs(childrenOf(node), refs, depth + 1);
  }
}

function resolveNode(
  node: XmlNode,
  refs: Map<string, XmlNode>,
  depth = 0,
): XmlNode {
  if (depth > 32) {
    throw new CaniasProtocolError("SOAP multiRef chain is too deep");
  }

  const href = attrsOf(node)["href"];
  if (href?.startsWith("#")) {
    const target = refs.get(href.slice(1));
    if (!target) {
      throw new CaniasProtocolError(`SOAP multiRef not found: ${href}`);
    }
    // Keep the reference tag (loginReturn, Response, ...) but take the
    // resolved content of the target node.
    const resolved = resolveNode(target, refs, depth + 1);
    const tag = tagOf(node);
    const out: XmlNode = {};
    if (tag) out[tag] = childrenOf(resolved);
    if (resolved[":@"]) out[":@"] = resolved[":@"];
    return out;
  }

  const tag = tagOf(node);
  if (!tag || !isElement(node)) return node;

  const out: XmlNode = {
    [tag]: childrenOf(node).map((child) => resolveNode(child, refs, depth + 1)),
  };
  if (node[":@"]) out[":@"] = node[":@"];
  return out;
}

/**
 * Parses an AXIS rpc/encoded response, resolves `multiRef`/`href`
 * references and returns the operation's return node.
 */
export function parseOperationResponse(
  xml: string,
  operation: string,
): ParsedOperation {
  let parsed: unknown;
  try {
    parsed = parser.parse(xml);
  } catch (cause) {
    throw new CaniasProtocolError("Response is not valid XML", { cause });
  }

  if (!Array.isArray(parsed)) {
    throw new CaniasProtocolError("Response XML has no root element");
  }

  const envelope = findChild(parsed as XmlNode[], "Envelope");
  if (!envelope) {
    throw new CaniasProtocolError("SOAP Envelope not found in response");
  }

  const body = findChild(childrenOf(envelope), "Body");
  if (!body) {
    throw new CaniasProtocolError("SOAP Body not found in response");
  }

  const bodyChildren = childrenOf(body);

  const faultNode = findChild(bodyChildren, "Fault");
  if (faultNode) {
    return {
      fault: {
        code:
          childText(faultNode, "faultcode") || childText(faultNode, "Code"),
        message:
          childText(faultNode, "faultstring") || childText(faultNode, "Reason"),
      },
      returnNode: null,
    };
  }

  const refs = new Map<string, XmlNode>();
  collectRefs(bodyChildren, refs);
  const resolved = bodyChildren.map((node) => resolveNode(node, refs));

  const response = findChild(resolved, `${operation}Response`);
  if (!response) {
    return { fault: null, returnNode: null };
  }

  const returnNode = findChild(
    childrenOf(response),
    `${operation}Return`,
  );

  return { fault: null, returnNode: returnNode ?? null };
}
