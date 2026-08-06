import { useEffect, useRef, type MutableRefObject } from "react";

export function useShiftKey(): MutableRefObject<boolean> {
	const isShiftHeldRef = useRef(false);

	useEffect(() => {
		const handleKeyDown = ({ key }: KeyboardEvent) => {
			if (key === "Shift") {
				isShiftHeldRef.current = true;
			}
		};

		const handleKeyUp = ({ key }: KeyboardEvent) => {
			if (key === "Shift") {
				isShiftHeldRef.current = false;
			}
		};

		const handleBlur = () => {
			isShiftHeldRef.current = false;
		};

		document.addEventListener("keydown", handleKeyDown);
		document.addEventListener("keyup", handleKeyUp);
		window.addEventListener("blur", handleBlur);

		return () => {
			document.removeEventListener("keydown", handleKeyDown);
			document.removeEventListener("keyup", handleKeyUp);
			window.removeEventListener("blur", handleBlur);
		};
	}, []);

	return isShiftHeldRef;
}
