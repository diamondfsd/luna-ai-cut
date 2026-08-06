type CancelFn = () => void;

const cancellers = new Set<CancelFn>();

export function registerCanceller({ fn }: { fn: CancelFn }): () => void {
	cancellers.add(fn);

	return () => {
		cancellers.delete(fn);
	};
}

export function cancelInteraction(): boolean {
	if (cancellers.size === 0) return false;

	const activeCancellers = Array.from(cancellers);
	cancellers.clear();

	for (const cancel of activeCancellers) {
		cancel();
	}

	return true;
}
