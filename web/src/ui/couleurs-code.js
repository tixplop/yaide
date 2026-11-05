import { HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

export const couleurs = HighlightStyle.define([
  { tag: [t.keyword, t.definitionKeyword, t.modifier, t.self], color: "var(--syn-keyword)" },
  { tag: [t.controlKeyword, t.moduleKeyword, t.operatorKeyword], color: "var(--syn-control)" },
  { tag: [t.string, t.special(t.string), t.regexp], color: "var(--syn-string)" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "var(--syn-function)" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "var(--syn-number)" },
  { tag: [t.typeName, t.className, t.tagName, t.namespace], color: "var(--syn-type)" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--syn-comment)", fontStyle: "italic" },
  { tag: [t.propertyName, t.variableName, t.attributeName], color: "var(--syn-variable)" },
  { tag: [t.punctuation, t.operator, t.bracket], color: "var(--syn-punctuation)" },
  { tag: t.heading, color: "var(--ink)", fontWeight: "600" },
  { tag: t.link, color: "var(--info)", textDecoration: "underline" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "600" },
]);
