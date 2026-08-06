import { ListNode } from "./list-node.js";
import { UI_CONTROL_NODE_DEFINITIONS } from "./control-nodes.js";
import { MarkdownInputNode } from "./markdown-node.js";
import { CatalogPickerNode } from "./catalog-picker-node.js";
import { CollectionNode } from "./collection-node.js";
import { UI_CONTAINER_NODE_DEFINITIONS } from "./container-nodes.js";
import { UI_DISPLAY_NODE_DEFINITIONS } from "./display-nodes.js";
import { ThumbnailButtonNode } from "./thumbnail-button-node.js";
import { ListButtonNode } from "./list-button-node.js";
import { SectionHeaderNode } from "./section-header-node.js";
import { WorkspaceShellNode } from "./workspace-shell-node.js";
import { DiagnosticsNode } from "./diagnostics-node.js";
import { PreviewSurfaceNode } from "./preview-surface-node.js";
import { OutputSurfaceNode, PresentationHudNode } from "./presentation-surface-node.js";
import { UI_REPORT_NODE_DEFINITIONS } from "./report-nodes.js";
import { LibraryCatalogNode } from "./library-catalog-node.js";
import { NodeDefinitionStudioNode, NodeGraphEditorNode } from "./node-graph-editor-node.js";
import { NodeDefinitionEditorNode } from "./node-definition-editor-node.js";
import { StartupStatusNode } from "./startup-status-node.js";
import { ChoiceGroupNode } from "./choice-group-node.js";
import { ResourceButtonNode } from "./resource-button-node.js";
import { ParameterAnimationEditorNode } from "./parameter-animation-node.js";
import { GlobalInputNode } from "./global-input-node.js";
import { FileDownloadNode } from "./file-download-node.js";
import { ClipboardNode } from "./clipboard-node.js";
import { WindowOpenNode } from "./window-open-node.js";

export const UiNodeDefinitions = Object.freeze([
  ListNode,
  ThumbnailButtonNode,
  ListButtonNode,
  SectionHeaderNode,
  WorkspaceShellNode,
  DiagnosticsNode,
  PreviewSurfaceNode,
  OutputSurfaceNode,
  PresentationHudNode,
  LibraryCatalogNode,
  NodeGraphEditorNode,
  NodeDefinitionStudioNode,
  NodeDefinitionEditorNode,
  StartupStatusNode,
  ChoiceGroupNode,
  ResourceButtonNode,
  ParameterAnimationEditorNode,
  GlobalInputNode,
  FileDownloadNode,
  ClipboardNode,
  WindowOpenNode,
  ...UI_REPORT_NODE_DEFINITIONS,
  ...UI_CONTROL_NODE_DEFINITIONS,
  MarkdownInputNode,
  CatalogPickerNode,
  CollectionNode,
  ...UI_CONTAINER_NODE_DEFINITIONS,
  ...UI_DISPLAY_NODE_DEFINITIONS,
]);
