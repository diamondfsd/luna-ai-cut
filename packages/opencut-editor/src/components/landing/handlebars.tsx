"use client";

import {
	type PropsWithChildren,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";

type HandlebarsProps = PropsWithChildren;

const MIN_HANDLE_SEPARATION_PX = 60;
const MASK_GRADIENT_EDGE_PADDING_PX = 10;
const HANDLEBARS_ROTATE_DEG = 2.76;
const RIGHT_HANDLE_LEFT_OFFSET_PX = -30;

export function Handlebars({ children }: HandlebarsProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const leftHandleRef = useRef<HTMLDivElement>(null);
	const rightHandleRef = useRef<HTMLDivElement>(null);

	const [width, setWidth] = useState(0);
	const [leftHandle, setLeftHandle] = useState(0);
	const [rightHandle, setRightHandle] = useState(0);

	const widthRef = useRef(0);
	const leftHandlePositionRef = useRef(0);
	const rightHandlePositionRef = useRef(0);

	const dragRef = useRef<{
		isDragging: boolean;
		side: "left" | "right" | null;
		pointerId: number | null;
		startX: number;
		initialPosition: number;
	}>({
		isDragging: false,
		side: null,
		pointerId: null,
		startX: 0,
		initialPosition: 0,
	});

	useLayoutEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const updateWidth = () => {
			const newWidth = container.offsetWidth;
			setWidth(newWidth);
			setRightHandle(newWidth);
		};

		const observer = new ResizeObserver(updateWidth);
		observer.observe(container);
		updateWidth();

		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		widthRef.current = width;
		leftHandlePositionRef.current = leftHandle;
		rightHandlePositionRef.current = rightHandle;
	}, [leftHandle, rightHandle, width]);

	useEffect(() => {
		const handlePointerMove = (event: PointerEvent) => {
			const { isDragging, side, pointerId, startX, initialPosition } =
				dragRef.current;

			if (!isDragging) return;
			if (pointerId !== null && event.pointerId !== pointerId) return;
			if (!side) return;

			const deltaX = event.clientX - startX;

			if (side === "left") {
				const maxLeft = Math.max(
					0,
					rightHandlePositionRef.current - MIN_HANDLE_SEPARATION_PX,
				);
				const nextLeftHandle = Math.max(
					0,
					Math.min(maxLeft, initialPosition + deltaX),
				);
				setLeftHandle(nextLeftHandle);
				return;
			}

			const minRight = Math.min(
				widthRef.current,
				leftHandlePositionRef.current + MIN_HANDLE_SEPARATION_PX,
			);
			const nextRightHandle = Math.max(
				minRight,
				Math.min(widthRef.current, initialPosition + deltaX),
			);
			setRightHandle(nextRightHandle);
		};

		const handlePointerEnd = (event: PointerEvent) => {
			const { pointerId } = dragRef.current;
			if (pointerId !== null && event.pointerId !== pointerId) return;

			dragRef.current.isDragging = false;
			dragRef.current.side = null;
			dragRef.current.pointerId = null;
		};

		window.addEventListener("pointermove", handlePointerMove);
		window.addEventListener("pointerup", handlePointerEnd);
		window.addEventListener("pointercancel", handlePointerEnd);

		return () => {
			window.removeEventListener("pointermove", handlePointerMove);
			window.removeEventListener("pointerup", handlePointerEnd);
			window.removeEventListener("pointercancel", handlePointerEnd);
		};
	}, []);

	const hasMeasuredWidth = width > 0;
	const leftGradientPercent = hasMeasuredWidth
		? (leftHandle / (width - MASK_GRADIENT_EDGE_PADDING_PX)) * 100
		: 0;
	const rightGradientPercent = hasMeasuredWidth
		? (rightHandle / (width + MASK_GRADIENT_EDGE_PADDING_PX)) * 100
		: 100;
	const textMask = hasMeasuredWidth
		? `linear-gradient(90deg,
            rgba(255, 255, 255, 0) 0%, 
            rgba(255, 255, 255, 0) ${leftGradientPercent}%, 
            rgba(0, 0, 0) ${leftGradientPercent}%, 
            rgba(0, 0, 0) ${rightGradientPercent}%, 
            rgba(255, 255, 255, 0) ${rightGradientPercent}%, 
            rgba(255, 255, 255, 0) 100%)`
		: undefined;

	return (
		<div className="flex justify-center gap-4 leading-16">
			<div
				ref={containerRef}
				className="relative mt-0.5"
				style={{ transform: `rotate(-${HANDLEBARS_ROTATE_DEG}deg)` }}
			>
				<div className="absolute inset-0 z-10 flex size-full justify-between rounded-2xl border border-yellow-500">
					<div
						ref={leftHandleRef}
						className="bg-background absolute left-0 z-20 flex h-full w-7 cursor-ew-resize touch-none items-center justify-center rounded-full border border-yellow-500 select-none"
						style={{
							translate: `${leftHandle}px 0`,
						}}
						onPointerDown={(event) => {
							event.preventDefault();
							leftHandleRef.current?.setPointerCapture(event.pointerId);
							dragRef.current.isDragging = true;
							dragRef.current.side = "left";
							dragRef.current.pointerId = event.pointerId;
							dragRef.current.startX = event.clientX;
							dragRef.current.initialPosition = leftHandlePositionRef.current;
						}}
					>
						<div className="h-8 w-2 rounded-full bg-yellow-500" />
					</div>

					<div
						ref={rightHandleRef}
						className="bg-background absolute z-20 flex h-full w-7 cursor-ew-resize touch-none items-center justify-center rounded-full border border-yellow-500 select-none"
						style={{
							left: hasMeasuredWidth
								? `${RIGHT_HANDLE_LEFT_OFFSET_PX}px`
								: undefined,
							right: hasMeasuredWidth ? undefined : "0px",
							translate: hasMeasuredWidth ? `${rightHandle}px 0` : undefined,
						}}
						onPointerDown={(event) => {
							event.preventDefault();
							rightHandleRef.current?.setPointerCapture(event.pointerId);
							dragRef.current.isDragging = true;
							dragRef.current.side = "right";
							dragRef.current.pointerId = event.pointerId;
							dragRef.current.startX = event.clientX;
							dragRef.current.initialPosition = rightHandlePositionRef.current;
						}}
					>
						<div className="h-8 w-2 rounded-full bg-yellow-500" />
					</div>
				</div>

				<span
					className="relative z-0 inline-flex size-full items-center justify-center rounded-2xl px-9 will-change-auto"
					style={{
						mask: textMask,
						WebkitMask: textMask,
					}}
				>
					{children}
				</span>
			</div>
		</div>
	);
}
