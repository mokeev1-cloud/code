import { EditorState, StateEffect, StateField, Compartment, Prec } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightSpecialChars, Decoration, ViewPlugin, hoverTooltip, showTooltip, tooltips } from '@codemirror/view';
import { StreamLanguage, syntaxHighlighting, HighlightStyle, bracketMatching, foldGutter, indentOnInput, indentUnit, foldService } from '@codemirror/language';
import { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo } from '@codemirror/commands';
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap, snippetCompletion } from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches, openSearchPanel } from '@codemirror/search';
import { linter, lintGutter, lintKeymap, forceLinting } from '@codemirror/lint';
import { tags } from '@lezer/highlight';
window.CM = { EditorState, StateEffect, StateField, Compartment, Prec, EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightSpecialChars, Decoration, ViewPlugin, hoverTooltip, showTooltip, tooltips,
  StreamLanguage, syntaxHighlighting, HighlightStyle, bracketMatching, foldGutter, indentOnInput, indentUnit, foldService,
  defaultKeymap, history, historyKeymap, indentWithTab, undo, redo, autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap, snippetCompletion,
  searchKeymap, highlightSelectionMatches, openSearchPanel, linter, lintGutter, lintKeymap, forceLinting, tags };
