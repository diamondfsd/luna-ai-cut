import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
} from "react";

export type OpenCutRoute =
	| { page: "projects" }
	| { page: "editor"; projectId: string };

type NavigationContextValue = {
	route: OpenCutRoute;
	navigate: (route: OpenCutRoute) => void;
};

const NavigationContext = createContext<NavigationContextValue | null>(null);

function parseRoute(href: string): OpenCutRoute {
	const match = /^\/editor\/([^/?#]+)/.exec(href);
	if (match?.[1]) {
		return { page: "editor", projectId: decodeURIComponent(match[1]) };
	}
	return { page: "projects" };
}

export function OpenCutNavigationProvider({
	route,
	onNavigate,
	children,
}: {
	route: OpenCutRoute;
	onNavigate: (route: OpenCutRoute) => void;
	children: ReactNode;
}) {
	const value = useMemo(
		() => ({ route, navigate: onNavigate }),
		[route, onNavigate],
	);
	return (
		<NavigationContext.Provider value={value}>
			{children}
		</NavigationContext.Provider>
	);
}

function useNavigationContext(): NavigationContextValue {
	const context = useContext(NavigationContext);
	if (!context) {
		throw new Error("OpenCut navigation must be used inside Luna's editor route");
	}
	return context;
}

export function useRouter() {
	const { navigate } = useNavigationContext();
	const push = useCallback((href: string) => navigate(parseRoute(href)), [navigate]);
	return useMemo(
		() => ({
			push,
			replace: push,
			back: () => navigate({ page: "projects" }),
			refresh: () => undefined,
			prefetch: async () => undefined,
		}),
		[navigate, push],
	);
}

export function useParams(): Record<string, string> {
	const { route } = useNavigationContext();
	return route.page === "editor" ? { project_id: route.projectId } : {};
}

export function usePathname(): string {
	const { route } = useNavigationContext();
	return route.page === "editor" ? `/editor/${route.projectId}` : "/projects";
}

export function notFound(): never {
	throw new Error("Page not found");
}

export { parseRoute as parseOpenCutRoute };
