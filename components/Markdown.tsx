import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// GitHub-flavoured markdown, no raw HTML (comments come from bots too).
export function Markdown({ children, className = "" }: { children: string; className?: string }) {
  return (
    <div className={`md text-sm leading-relaxed text-ink-2 ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer" className="text-info underline decoration-info/30 underline-offset-2 hover:decoration-info">
              {children}
            </a>
          ),
          h1: ({ children }) => <h3 className="mt-5 mb-2 text-base font-medium text-ink">{children}</h3>,
          h2: ({ children }) => <h3 className="mt-5 mb-2 text-base font-medium text-ink">{children}</h3>,
          h3: ({ children }) => <h4 className="mt-4 mb-1.5 text-sm font-medium text-ink">{children}</h4>,
          p: ({ children }) => <p className="my-2">{children}</p>,
          ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
          strong: ({ children }) => <strong className="font-medium text-ink">{children}</strong>,
          code: ({ children, className }) =>
            className ? <code className={className}>{children}</code> : <code className="inline">{children}</code>,
          pre: ({ children }) => (
            <pre className="my-3 overflow-x-auto rounded-lg border border-line bg-bg p-3 font-mono text-xs text-ink-2">{children}</pre>
          ),
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto">
              <table className="w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => <th className="border-b border-line px-2 py-1.5 text-left font-medium text-ink">{children}</th>,
          td: ({ children }) => <td className="border-b border-line/60 px-2 py-1.5 font-mono">{children}</td>,
          img: () => null,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
