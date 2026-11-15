// ESM port of `use-sync-external-store/with-selector` (React, MIT license,
// Copyright (c) Meta Platforms, Inc. and affiliates). The package ships only
// CommonJS, which calls `require("react")`; with React external, the bundler can
// only turn that into a runtime `require` the browser does not have. The logic
// is the package's production build, unchanged.
import { useDebugValue, useEffect, useMemo, useRef, useSyncExternalStore } from "react";

interface SelectionInstance<Selection> {
	hasValue: boolean;
	value: Selection | null;
}

export function useSyncExternalStoreWithSelector<Snapshot, Selection>(
	subscribe: (onStoreChange: () => void) => () => void,
	getSnapshot: () => Snapshot,
	getServerSnapshot: undefined | null | (() => Snapshot),
	selector: (snapshot: Snapshot) => Selection,
	isEqual?: (a: Selection, b: Selection) => boolean,
): Selection {
	const instRef = useRef<SelectionInstance<Selection> | null>(null);
	instRef.current ??= { hasValue: false, value: null };
	const inst = instRef.current;

	const [getSelection, getServerSelection] = useMemo(() => {
		let hasMemo = false;
		let memoizedSnapshot: Snapshot;
		let memoizedSelection: Selection;
		const memoizedSelector = (nextSnapshot: Snapshot): Selection => {
			if (!hasMemo) {
				hasMemo = true;
				memoizedSnapshot = nextSnapshot;
				const nextSelection = selector(nextSnapshot);
				if (isEqual !== undefined && inst.hasValue) {
					const currentSelection = inst.value as Selection;
					if (isEqual(currentSelection, nextSelection)) {
						memoizedSelection = currentSelection;
						return currentSelection;
					}
				}
				memoizedSelection = nextSelection;
				return nextSelection;
			}
			const currentSelection = memoizedSelection;
			if (Object.is(memoizedSnapshot, nextSnapshot)) {
				return currentSelection;
			}
			const nextSelection = selector(nextSnapshot);
			if (isEqual !== undefined && isEqual(currentSelection, nextSelection)) {
				memoizedSnapshot = nextSnapshot;
				return currentSelection;
			}
			memoizedSnapshot = nextSnapshot;
			memoizedSelection = nextSelection;
			return nextSelection;
		};
		const serverSnapshot = getServerSnapshot ?? null;
		return [
			() => memoizedSelector(getSnapshot()),
			serverSnapshot === null ? undefined : () => memoizedSelector(serverSnapshot()),
		];
	}, [getSnapshot, getServerSnapshot, selector, isEqual]);

	const value = useSyncExternalStore(subscribe, getSelection, getServerSelection);
	useEffect(() => {
		inst.hasValue = true;
		inst.value = value;
	}, [value]);
	useDebugValue(value);
	return value;
}
