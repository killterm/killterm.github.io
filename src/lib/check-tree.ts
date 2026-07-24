export interface CheckTree<NodeId> {
  childrenOf(id: NodeId): readonly NodeId[];
  parentOf(id: NodeId): NodeId | undefined;
  isChecked(id: NodeId): boolean;
  setChecked(id: NodeId, checked: boolean): void;
}

// 선택한 노드와 모든 하위 노드를 같은 상태로 변경한다.
export function setSubtreeChecked<NodeId>(
  tree: CheckTree<NodeId>,
  root: NodeId,
  checked: boolean,
) {
  const pending = [root];
  const visited = new Set<NodeId>();

  while (pending.length > 0) {
    const id = pending.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    tree.setChecked(id, checked);
    pending.push(...tree.childrenOf(id));
  }
}

// 변경된 노드의 직계 부모부터 루트까지 체크 상태를 다시 계산한다.
export function syncAncestors<NodeId>(tree: CheckTree<NodeId>, changed: NodeId) {
  const visited = new Set<NodeId>();
  let current = tree.parentOf(changed);

  while (current !== undefined && !visited.has(current)) {
    visited.add(current);
    const children = tree.childrenOf(current);
    if (children.length > 0) {
      tree.setChecked(
        current,
        children.every((child) => tree.isChecked(child)),
      );
    }
    current = tree.parentOf(current);
  }
}

// 저장 데이터를 불러온 뒤 모든 부모를 하위 노드 상태에 맞게 정규화한다.
export function syncSubtreeFromLeaves<NodeId>(tree: CheckTree<NodeId>, root: NodeId) {
  const pending: Array<{ id: NodeId; expanded: boolean }> = [{ id: root, expanded: false }];
  const visited = new Set<NodeId>();

  while (pending.length > 0) {
    const { id, expanded } = pending.pop()!;
    if (expanded) {
      const children = tree.childrenOf(id);
      if (children.length > 0) {
        tree.setChecked(
          id,
          children.every((child) => tree.isChecked(child)),
        );
      }
      continue;
    }
    if (visited.has(id)) continue;
    visited.add(id);
    pending.push({ id, expanded: true });
    for (const child of tree.childrenOf(id)) {
      pending.push({ id: child, expanded: false });
    }
  }
}
