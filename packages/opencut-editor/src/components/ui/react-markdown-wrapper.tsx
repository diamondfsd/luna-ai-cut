import ReactMarkdown from "react-markdown";
import { cn } from "@/utils/ui";

export function ReactMarkdownWrapper({
	children,
	inline = false,
}: {
	children: string;
	inline?: boolean;
}) {
	return (
		<ReactMarkdown
			components={{
				a: ({ className: linkClassName, children, ...props }) => (
					<a
						className={cn("text-primary hover:underline", linkClassName)}
						target="_blank"
						rel="noopener noreferrer"
						{...props}
					>
						{children}
					</a>
				),
				strong: ({ children }) => (
					<strong className="text-foreground font-semibold">{children}</strong>
				),
				code: ({ className: codeClassName, children, ...props }) => (
					<code
						className={cn(
							"rounded border border-destructive/20 bg-destructive/5 px-1.5 py-0.5 font-mono text-[0.85em] text-red-700 dark:text-red-300",
							codeClassName,
						)}
						{...props}
					>
						{children}
					</code>
				),
				p: ({ className: paragraphClassName, children, ...props }) =>
					inline ? (
						<span className={cn("m-0", paragraphClassName)} {...props}>
							{children}
						</span>
					) : (
						<p className={cn("m-0", paragraphClassName)} {...props}>
							{children}
						</p>
					),
			}}
		>
			{children}
		</ReactMarkdown>
	);
}
