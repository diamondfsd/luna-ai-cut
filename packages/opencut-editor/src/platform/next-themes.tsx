import { type ReactNode } from "react";

export function ThemeProvider({ children }: { children: ReactNode }) {
	return <>{children}</>;
}

export function useTheme() {
	return {
		theme: "dark",
		resolvedTheme: "dark",
		setTheme: (theme: string) => {
			document.documentElement.classList.toggle("dark", theme === "dark");
		},
	};
}
