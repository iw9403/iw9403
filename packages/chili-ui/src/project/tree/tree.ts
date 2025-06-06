// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument, INode, INodeLinkedList, NodeRecord, PubSub, Transaction } from "chili-core";
import { Control } from "../../components";
import style from "./tree.module.css";
import { TreeItem } from "./treeItem";
import { TreeGroup } from "./treeItemGroup";
import { TreeModel } from "./treeModel";

export class Tree extends Control {
    private readonly nodeMap = new WeakMap<INode, TreeItem>();
    private lastClicked: INode | undefined;
    private readonly selectedNodes: Set<INode> = new Set();
    private dragging: INode[] | undefined;

    constructor(readonly document: IDocument) {
        super(style.panel);
        this.addAllNodes(document, this, document.rootNode);
        this.addDisconnectedCallback(() => {
            PubSub.default.remove("selectionChanged", this.handleSelectionChanged);
            PubSub.default.remove("nodeLinkedListChanged", this.handleNodeLinkedChanged);
        });
        this.addConnectedCallback(() => {
            PubSub.default.sub("selectionChanged", this.handleSelectionChanged);
            PubSub.default.sub("nodeLinkedListChanged", this.handleNodeLinkedChanged);
        });
    }

    override dispose(): void {
        super.dispose();
        this.lastClicked = undefined;
        this.dragging = undefined;
        this.selectedNodes.clear();
        PubSub.default.remove("selectionChanged", this.handleSelectionChanged);
        PubSub.default.remove("nodeLinkedListChanged", this.handleNodeLinkedChanged);
    }

    private handleNodeLinkedChanged = (records: NodeRecord[]) => {
        this.ensureHasHTML(records);
        for (const record of records) {
            let ele = this.nodeMap.get(record.node);
            if (ele === undefined) continue;
            if (record.oldParent !== undefined) {
                this.nodeMap.get(record.oldParent)?.removeChild(ele);
            }
            if (record.newParent !== undefined) {
                let parent = this.nodeMap.get(record.newParent);
                if (parent !== undefined && parent instanceof TreeGroup) {
                    let pre = record.newPrevious === undefined ? null : this.nodeMap.get(record.newPrevious);
                    parent.insertAfter(ele, pre ?? null);
                }
            }
        }
    };

    private handleSelectionChanged = (document: IDocument, selected: INode[], unselected: INode[]) => {
        unselected.forEach((x) => {
            this.nodeMap.get(x)?.removeSelectedStyle(style.selected);
            this.selectedNodes.delete(x);
        });
        this.setLastClickItem(undefined);
        selected.forEach((model) => {
            this.selectedNodes.add(model);
            this.nodeMap.get(model)?.addSelectedStyle(style.selected);
        });
        this.scrollToNode(selected);
    };

    private ensureHasHTML(records: NodeRecord[]) {
        records.forEach((record) => {
            if (!this.nodeMap.has(record.node)) {
                this.nodeMap.set(record.node, this.createHTMLElement(this.document, record.node));
            }
        });
    }

    private scrollToNode(selected: INode[]) {
        let node = selected.at(0);
        if (node !== undefined) {
            let parent = node.parent;
            while (parent) {
                const group = this.nodeMap.get(parent) as TreeGroup;
                if (group !== undefined) {
                    if (group.isExpanded === false) {
                        group.isExpanded = true;
                    }
                    parent = parent.parent;
                }
            }
            this.nodeMap.get(node)?.scrollIntoView({ block: "nearest" });
        }
    }

    private addAllNodes(document: IDocument, parent: HTMLElement, node: INode) {
        let element = this.createHTMLElement(document, node);
        this.nodeMap.set(node, element);
        parent.appendChild(element);

        if (INode.isLinkedListNode(node)) {
            if (node.firstChild) {
                this.addAllNodes(document, element, node.firstChild);
            }
            if (node.nextSibling) {
                this.addAllNodes(document, parent, node.nextSibling);
            }
        }
    }

    private createHTMLElement(document: IDocument, node: INode): TreeItem {
        let result: TreeItem;
        if (INode.isLinkedListNode(node)) result = new TreeGroup(document, node);
        else if (INode.isModelNode(node)) result = new TreeModel(node);
        else throw new Error("unknown node");

        result.addConnectedCallback(() => this.addEvents(result));
        result.addDisconnectedCallback(() => this.removeEvents(result));

        return result;
    }

    private addEvents(item: HTMLElement) {
        item.addEventListener("dragstart", this.onDragStart);
        item.addEventListener("dragover", this.onDragOver);
        item.addEventListener("dragleave", this.onDragLeave);
        item.addEventListener("drop", this.onDrop);
        item.addEventListener("click", this.onClick);
    }

    private removeEvents(item: HTMLElement) {
        item.removeEventListener("dragstart", this.onDragStart);
        item.removeEventListener("dragover", this.onDragOver);
        item.removeEventListener("dragleave", this.onDragLeave);
        item.removeEventListener("drop", this.onDrop);
        item.removeEventListener("click", this.onClick);
    }

    private getTreeItem(item: HTMLElement | null): TreeItem | undefined {
        if (item === null) return undefined;
        if (item instanceof TreeItem) return item;
        return this.getTreeItem(item.parentElement);
    }

    private onClick = (event: MouseEvent) => {
        let item = this.getTreeItem(event.target as HTMLElement)?.node;
        if (item === undefined) return;
        event.stopPropagation();

        if (event.shiftKey) {
            if (this.lastClicked !== undefined) {
                let nodes = INode.getNodesBetween(this.lastClicked, item);
                this.document.selection.select(nodes, false);
            }
        } else {
            this.document.selection.select([item], event.ctrlKey);
        }

        this.setLastClickItem(item);
    };

    private onDragLeave = (event: DragEvent) => {
        if (!this.canDrop(event)) return;
    };

    private onDragOver = (event: DragEvent) => {
        if (!this.canDrop(event)) {
            return;
        }
        event.preventDefault();
        event.dataTransfer!.dropEffect = "move";
    };

    private setLastClickItem(item: INode | undefined) {
        if (this.lastClicked !== undefined) {
            this.nodeMap.get(this.lastClicked)?.removeSelectedStyle(style.current);
        }
        this.lastClicked = item;
        if (item !== undefined) {
            this.nodeMap.get(item)?.addSelectedStyle(style.current);
            this.document.currentNode = INode.isLinkedListNode(item) ? item : item.parent;
        }
    }

    private canDrop(event: DragEvent) {
        let node = this.getTreeItem(event.target as HTMLElement)?.node;
        if (node === undefined) return false;
        if (this.dragging?.includes(node)) return false;
        let parent = node.parent;
        while (parent !== undefined) {
            if (this.dragging?.includes(parent)) return false;
            parent = parent.parent;
        }
        return true;
    }

    protected onDrop = (event: DragEvent) => {
        event.preventDefault();
        event.stopPropagation();

        let node = this.getTreeItem(event.target as HTMLElement)?.node;
        if (node === undefined) return;
        Transaction.excute(this.document, "move node", () => {
            let isLinkList = INode.isLinkedListNode(node!);
            let newParent = isLinkList ? (node as INodeLinkedList) : node!.parent;
            let target = isLinkList ? undefined : node;
            this.dragging?.forEach((x) => {
                x.parent?.move(x, newParent!, target);
            });
        });

        this.dragging = undefined;
    };

    private onDragStart = (event: DragEvent) => {
        event.stopPropagation();
        let item = this.getTreeItem(event.target as HTMLElement)?.node;
        this.dragging = this.findAllCommonParents();
        if (item !== undefined && !this.selectedNodes.has(item)) {
            this.dragging.push(item);
        }
    };

    private findAllCommonParents() {
        let result: INode[] = [];
        for (const node of this.selectedNodes) {
            if (node.parent === undefined || !this.selectedNodes.has(node.parent)) {
                result.push(node);
            }
        }
        return result;
    }
}

customElements.define("ui-tree", Tree);
