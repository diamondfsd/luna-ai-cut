import { forwardRef, type AnchorHTMLAttributes, type MouseEvent } from "react";
import { parseOpenCutRoute, useRouter } from "./next-navigation";

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
	href: string;
};

const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
	{ href, onClick, target, ...props },
	ref,
) {
	const router = useRouter();
	const isInternal = href.startsWith("/");

	function handleClick(event: MouseEvent<HTMLAnchorElement>) {
		onClick?.(event);
		if (
			event.defaultPrevented ||
			!isInternal ||
			target === "_blank" ||
			event.metaKey ||
			event.ctrlKey ||
			event.shiftKey ||
			event.altKey
		) {
			return;
		}
		event.preventDefault();
		const route = parseOpenCutRoute(href);
		router.push(route.page === "editor" ? `/editor/${route.projectId}` : "/projects");
	}

	return <a ref={ref} href={href} target={target} onClick={handleClick} {...props} />;
});

export default Link;
