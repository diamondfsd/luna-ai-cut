import { forwardRef, type ImgHTMLAttributes } from "react";

type ImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
	src: string | { src: string };
	fill?: boolean;
	priority?: boolean;
	quality?: number;
	unoptimized?: boolean;
};

const Image = forwardRef<HTMLImageElement, ImageProps>(function Image(
	{ src, fill, priority, quality: _quality, unoptimized: _unoptimized, style, ...props },
	ref,
) {
	return (
		<img
			ref={ref}
			src={typeof src === "string" ? src : src.src}
			loading={priority ? "eager" : props.loading}
			style={fill ? { ...style, position: "absolute", inset: 0 } : style}
			{...props}
		/>
	);
});

export default Image;
