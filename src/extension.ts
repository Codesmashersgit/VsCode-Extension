import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {

    const diagnostics =
        vscode.languages.createDiagnosticCollection('hoverErrors');
    context.subscriptions.push(diagnostics);

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(doc =>
            updateDiagnostics(doc, diagnostics)
        )
    );

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(e =>
            updateDiagnostics(e.document, diagnostics)
        )
    );

    if (vscode.window.activeTextEditor) {
        updateDiagnostics(
            vscode.window.activeTextEditor.document,
            diagnostics
        );
    }
}

function updateDiagnostics(
    document: vscode.TextDocument,
    collection: vscode.DiagnosticCollection
) {

    // ❌ ONLY JavaScript
    if (document.languageId !== 'javascript') {
        collection.delete(document.uri);
        return;
    }

    const config = vscode.workspace.getConfiguration('hoverErrors');
    const lang = config.get<string>('language', 'en');

    const diagnostics: vscode.Diagnostic[] = [];
    const text = document.getText();

    /* ❌ Missing semicolon */
    const semicolonRegex = /[^\s;{}]\n/g;
    let match: RegExpExecArray | null;

    while ((match = semicolonRegex.exec(text))) {
        const range = new vscode.Range(
            document.positionAt(match.index),
            document.positionAt(match.index + 1)
        );

        diagnostics.push(
            new vscode.Diagnostic(
                range,
                message('semicolon', lang),
                vscode.DiagnosticSeverity.Error
            )
        );
    }

    /* ❌ Undefined variable */
    const undefinedRegex = /\bconsole\.log\((\w+)\)/g;

    while ((match = undefinedRegex.exec(text))) {
        const name = match[1];

        if (!new RegExp(`\\b(let|const|var)\\s+${name}\\b`).test(text)) {
            const start = match.index + 'console.log('.length;

            const range = new vscode.Range(
                document.positionAt(start),
                document.positionAt(start + name.length)
            );

            diagnostics.push(
                new vscode.Diagnostic(
                    range,
                    message('undefined', lang, name),
                    vscode.DiagnosticSeverity.Error
                )
            );
        }
    }

    collection.set(document.uri, diagnostics);
}

function message(
    type: 'semicolon' | 'undefined',
    lang: string,
    value?: string
) {
    const map = {
        semicolon: {
            en: 'Missing semicolon',
            hi: 'Semicolon missing hai'
        },
        undefined: {
            en: `Undefined variable: ${value}`,
            hi: `Variable define nahi hai: ${value}`
        }
    };

    return map[type][lang as 'en' | 'hi'] || map[type].en;
}

export function deactivate() {}
