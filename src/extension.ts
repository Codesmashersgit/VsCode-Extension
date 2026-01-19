import * as vscode from 'vscode';

// ================= Messages =================
const MESSAGES = {
    semicolon: {
        en: 'Missing semicolon',
        hi: 'Semicolon missing hai!'
    },
    undefined: {
        en: (varName: string) => `Variable '${varName}' is not defined`,
        hi: (varName: string) => `Variable '${varName}' define nahi hai`
    },
    hoverIncompleteFunction: {
        en: 'Function declaration incomplete. Missing parenthesis or opening brace.',
        hi: 'Function declaration adhura hai. Parenthesis ya opening brace missing hai.'
    },
    hoverIncompleteBlock: {
        en: 'Block is incomplete. Missing closing brace, bracket, or parenthesis.',
        hi: 'Block adhura hai. Closing brace, bracket, ya parenthesis missing hai.'
    },
    hoverSemicolon: {
        en: 'Add a semicolon at the end of the statement.',
        hi: 'Statement ke end mein semicolon add karo.'
    },
    hoverUndefined: {
        en: 'Make sure this variable is declared with let, const, var, or function parameter.',
        hi: 'Check karo ki variable ko let, const, var ya function parameter se declare kiya hai ya nahi.'
    },
    hoverUnusedFunction: {
        en: "Function is declared but never called.",
        hi: "Function declare hua hai par kabhi call nahi hua."
    }
};

// ================= Activate Extension =================
export function activate(context: vscode.ExtensionContext) {
    console.log('🚀 Extension activated!');

    const diagnostics = vscode.languages.createDiagnosticCollection('custom-errors');
    context.subscriptions.push(diagnostics);

    // Hover provider
    context.subscriptions.push(
        vscode.languages.registerHoverProvider(
            ['javascript', 'typescript', 'java'],
            new CustomHoverProvider()
        )
    );

    // Listen to document changes
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(doc => updateDiagnostics(doc, diagnostics))
    );
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(e => updateDiagnostics(e.document, diagnostics))
    );
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) updateDiagnostics(editor.document, diagnostics);
        })
    );
    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument(doc => diagnostics.delete(doc.uri))
    );

    // Process already open editors
    vscode.window.visibleTextEditors.forEach(editor => updateDiagnostics(editor.document, diagnostics));
}

// ================= Hover Provider =================
class CustomHoverProvider implements vscode.HoverProvider {
    provideHover(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.ProviderResult<vscode.Hover> {
        const lang = getLanguagePreference();
        const lineText = document.lineAt(position.line).text;

        // 1️⃣ Incomplete block detection
        const blockErrors = checkDocumentSymbols(document).missingSymbols;
        if (blockErrors.some(err => err.line === position.line)) {
            const md = new vscode.MarkdownString(
                `🔴 **Incomplete block**\n\n` +
                `📝 ${MESSAGES.hoverIncompleteBlock.en}\n` +
                `🇮🇳 ${MESSAGES.hoverIncompleteBlock.hi}`
            );
            md.isTrusted = true;
            return new vscode.Hover(md);
        }

        // 2️⃣ Undefined variable detection
        const undefMsg = checkUndefinedVariable(document, position, lineText, lang);
        if (undefMsg) {
            const varName = extractVarName(lineText, position);
            const md = new vscode.MarkdownString(
                `🔴 **Variable '${varName}' is not defined**\n\n` +
                `📝 ${MESSAGES.hoverUndefined.en}\n` +
                `🇮🇳 ${MESSAGES.hoverUndefined.hi}`
            );
            md.isTrusted = true;
            return new vscode.Hover(md);
        }

        // 3️⃣ Unused function warning
        const unusedFn = checkUnusedFunction(document, position);
        if (unusedFn) {
            const md = new vscode.MarkdownString(
                `⚠️ **Function '${unusedFn}' is declared but never called**\n\n` +
                `📝 ${MESSAGES.hoverUnusedFunction.en}\n` +
                `🇮🇳 ${MESSAGES.hoverUnusedFunction.hi}`
            );
            md.isTrusted = true;
            return new vscode.Hover(md);
        }

        return null;
    }
}

// ================= Diagnostics Update =================
function updateDiagnostics(document: vscode.TextDocument, collection: vscode.DiagnosticCollection) {
    if (!['javascript', 'typescript', 'java'].includes(document.languageId)) {
        collection.delete(document.uri);
        return;
    }
    if (document.isUntitled) return;

    const lang = getLanguagePreference();
    const diagnostics: vscode.Diagnostic[] = [];
    const text = document.getText();
    const lines = text.split('\n');

    // 1️⃣ Unmatched symbols
    const blockErrors = checkDocumentSymbols(document).missingSymbols;
    blockErrors.forEach(err => {
        const range = new vscode.Range(
            new vscode.Position(err.line, 0),
            new vscode.Position(err.line, lines[err.line].length)
        );
        diagnostics.push(new vscode.Diagnostic(range, MESSAGES.hoverIncompleteBlock[lang], vscode.DiagnosticSeverity.Error));
    });

    // 2️⃣ Missing semicolons (only for Java)
    if (document.languageId === 'java') detectMissingSemicolons(lines, diagnostics, lang);

    // 3️⃣ Undefined variables
    if (document.languageId === 'java') detectUndefinedVariablesJava(text, document, diagnostics, lang);
    else detectUndefinedVariables(text, document, diagnostics, lang);

    // 4️⃣ Unused functions
    detectUnusedFunctions(text, document, diagnostics, lang);

    collection.set(document.uri, diagnostics);
}

// ================= Language Preference =================
function getLanguagePreference(): 'en' | 'hi' {
    const config = vscode.workspace.getConfiguration('hoverErrors');
    const lang = config.get<string>('language', 'en');
    return (lang === 'hi' ? 'hi' : 'en') as 'en' | 'hi';
}

// ================= Symbol / Block Check =================
interface StackItem { char: string; line: number; column: number; }
interface SymbolError { char: string; line: number; column: number; }

function checkDocumentSymbols(document: vscode.TextDocument): { missingSymbols: SymbolError[] } {
    const text = document.getText();
    const stack: SymbolError[] = [];
    const errors: SymbolError[] = [];
    const opening = '({[';
    const closing = ')}]';
    const pairs: { [key: string]: string } = { ')': '(', '}': '{', ']': '[' };

    const lines = text.split('\n');

    lines.forEach((line, lineIndex) => {
        for (let col = 0; col < line.length; col++) {
            const ch = line[col];
            if (opening.includes(ch)) stack.push({ char: ch, line: lineIndex, column: col });
            else if (closing.includes(ch)) {
                if (stack.length === 0 || stack[stack.length - 1].char !== pairs[ch]) {
                    errors.push({ char: ch, line: lineIndex, column: col });
                } else {
                    stack.pop();
                }
            }
        }
    });

    stack.forEach(item => errors.push(item));
    return { missingSymbols: errors };
}

// ================= Undefined Variable Detection =================
function getAllDeclaredVariables(text: string): Set<string> {
    const vars = new Set<string>();
    const declareRegex = /(?:let|const|var)\s+(\w+)/g;
    let match: RegExpExecArray | null;
    while ((match = declareRegex.exec(text))) vars.add(match[1]);

    // Function declarations (hoisted)
    const funcDeclRegex = /function\s+(\w+)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = funcDeclRegex.exec(text))) vars.add(m[1]);

    // Function parameters
    const funcParamsRegex = /function\s+\w*\s*\(([^)]*)\)/g;
    while ((m = funcParamsRegex.exec(text))) {
        m[1].split(',').map(p => p.trim()).forEach(p => { if (p) vars.add(p); });
    }

    // JS globals
    ['console','undefined','null','window','document','global','process','module','exports'].forEach(v=>vars.add(v));
    return vars;
}

// Extract bare variable names from console.log (ignore strings and expressions)
function extractAllConsoleVars(line: string): string[] {
    const match = line.match(/console\.log\s*\((.*)\)/);
    if (!match) return [];
    const inside = match[1];

    const vars: string[] = [];
    let current = '';
    let inString = false;
    let quoteChar = '';
    for (let i = 0; i < inside.length; i++) {
        const ch = inside[i];
        if ((ch === '"' || ch === "'" || ch === '`') && !inString) {
            inString = true;
            quoteChar = ch;
            current += ch;
            continue;
        }
        if (ch === quoteChar && inString) {
            inString = false;
            current += ch;
            continue;
        }
        if (ch === ',' && !inString) {
            vars.push(current.trim());
            current = '';
            continue;
        }
        current += ch;
    }
    if (current.trim()) vars.push(current.trim());

    return vars.filter(v => /^[a-zA-Z_$][\w$]*$/.test(v));
}

function checkUndefinedVariable(document: vscode.TextDocument, position: vscode.Position, line: string, lang: 'en' | 'hi'): string | null {
    const declared = getAllDeclaredVariables(document.getText());
    const words = extractAllConsoleVars(line);
    for (const w of words) if (!declared.has(w)) return MESSAGES.undefined[lang](w);
    return null;
}

function detectUndefinedVariables(text: string, document: vscode.TextDocument, diagnostics: vscode.Diagnostic[], lang: 'en' | 'hi') {
    const regex = /console\.log\s*\(([^)]*)\)/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text))) {
        const vars = extractAllConsoleVars(match[0]);
        const declared = getAllDeclaredVariables(text);
        for (const varName of vars) {
            if (!declared.has(varName)) {
                const start = match.index + match[0].indexOf(varName);
                const pos = document.positionAt(start);
                const range = new vscode.Range(pos, pos.translate(0, varName.length));
                const msg = MESSAGES.undefined[lang](varName);
                diagnostics.push(new vscode.Diagnostic(range, msg, vscode.DiagnosticSeverity.Error));
            }
        }
    }
}

// ================= Unused Function Detection =================
function detectUnusedFunctions(text: string, document: vscode.TextDocument, diagnostics: vscode.Diagnostic[], lang: 'en' | 'hi') {
    const funcDeclRegex = /function\s+(\w+)\s*\(/g;
    let match: RegExpExecArray | null;
    const declaredFuncs: string[] = [];
    while ((match = funcDeclRegex.exec(text))) declaredFuncs.push(match[1]);

    declaredFuncs.forEach(fn => {
        const calledRegex = new RegExp(`\\b${fn}\\s*\\(`, 'g');
        const callMatches = text.match(calledRegex);
        if (!callMatches || callMatches.length <= 1) { // only declaration, no call
            const posIndex = text.indexOf(`function ${fn}`);
            const pos = document.positionAt(posIndex);
            const range = new vscode.Range(pos, pos.translate(0, fn.length + 9));
            diagnostics.push(new vscode.Diagnostic(range, MESSAGES.hoverUnusedFunction[lang], vscode.DiagnosticSeverity.Warning));
        }
    });
}

function checkUnusedFunction(document: vscode.TextDocument, position: vscode.Position): string | null {
    const text = document.getText();
    const funcs: string[] = [];
    const funcDeclRegex = /function\s+(\w+)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = funcDeclRegex.exec(text))) funcs.push(m[1]);

    for (const fn of funcs) {
        const callRegex = new RegExp(`\\b${fn}\\s*\\(`, 'g');
        const matches = text.match(callRegex);
        if (!matches || matches.length <= 1) { // only declaration
            const lineStart = text.substring(0, text.indexOf(`function ${fn}`)).split('\n').length - 1;
            if (lineStart === position.line) return fn;
        }
    }
    return null;
}

// ================= Semicolon Detection (Java only) =================
function detectMissingSemicolons(lines: string[], diagnostics: vscode.Diagnostic[], lang: 'en' | 'hi') {
    lines.forEach((line, i) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.endsWith(';') || trimmed.endsWith('{') || trimmed.endsWith('}') || trimmed.startsWith('//')) return;
        const range = new vscode.Range(new vscode.Position(i, 0), new vscode.Position(i, line.length));
        diagnostics.push(new vscode.Diagnostic(range, MESSAGES.semicolon[lang], vscode.DiagnosticSeverity.Error));
    });
}

// ================= Java Undefined Variable Detection =================
function getAllDeclaredVariablesJava(text: string): Set<string> {
    const vars = new Set<string>();
    const regex = /(?:int|String|double|float|boolean|long|short|byte|char|var)\s+(\w+)/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text))) vars.add(m[1]);
    ['System','out','println','String','Integer','Double','Float','Boolean','ArrayList','HashMap'].forEach(v=>vars.add(v));
    return vars;
}

function detectUndefinedVariablesJava(text: string, document: vscode.TextDocument, diagnostics: vscode.Diagnostic[], lang: 'en' | 'hi') {
    const declared = getAllDeclaredVariablesJava(text);
    const regex = /System\.out\.println\s*\(\s*(\w+)\s*\)/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text))) {
        const varName = match[1];
        if (!declared.has(varName)) {
            const start = match.index + match[0].indexOf(varName);
            const pos = document.positionAt(start);
            const range = new vscode.Range(pos, pos.translate(0, varName.length));
            const msg = MESSAGES.undefined[lang](varName);
            diagnostics.push(new vscode.Diagnostic(range, msg, vscode.DiagnosticSeverity.Error));
        }
    }
}

function extractVarName(line: string, position: vscode.Position): string {
    const match = /\b(\w+)\b/g;
    let varName = 'variable';
    let m: RegExpExecArray | null;
    while ((m = match.exec(line))) {
        const start = m.index;
        const end = start + m[1].length;
        if (position.character >= start && position.character <= end) {
            varName = m[1];
            break;
        }
    }
    return varName;
}

// ================= Deactivate =================
export function deactivate() {
    console.log('👋 Extension deactivated!');
}
