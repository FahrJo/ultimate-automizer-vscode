import * as vscode from 'vscode';
import * as fs from 'fs';
import { SingleUltimateResult, UltimateBase } from './ultimate';
import { HttpResponse, unifiedHttpsRequest } from './httpsRequest';
import path = require('path');

export class UltimateByHttp extends UltimateBase {
    private apiUrl: URL;
    private requestId = '';
    public refreshTimeInMilliseconds = 500;

    constructor(
        context: vscode.ExtensionContext,
        settings: vscode.Uri,
        toolchain: vscode.Uri,
        apiUrl: string
    ) {
        super(context);
        this.apiUrl = new URL(apiUrl);
        this.setSettingsFile(settings);
        this.setToolchainFile(toolchain);
    }

    public runOn(input: string | vscode.TextDocument, language: string = 'c'): void {
        let code = '';
        let fileExtension = language;
        let document: vscode.TextDocument;
        if (this.isDocument(input) && (input.languageId === 'c' || input.languageId === 'boogie')) {
            document = input;
            code = document.getText();
            fileExtension = vscode.window.activeTextEditor?.document.uri.fsPath.split('.').pop()!;
        } else if (typeof input === 'string') {
            code = input;
        }

        if (!this.isLocked()) {
            this.lockUltimate();
            this.outputChannel.clear();
            this.showProgressInStatusBar('Fetching Ultimate results...');
            this.fetchResults(code.trim(), fileExtension)
                .then((response) => this.parseResponse(response))
                .then(() => this.pollResults())
                .then(() => this.outputChannel.show())
                .then(() => this.printResultsToOutput())
                .then(() => this.printResultsToLog())
                .then(() => this.embedDiagnosticInfoInto(document))
                .then(() => this.stopShowingProgressInStatusBar())
                .then(() => this.freeUltimate())
                .catch((error: any) => {
                    console.log(error);
                    this.stopShowingProgressInStatusBar();
                    this.freeUltimate();
                });
        }
    }

    public fetchResults(code: string, fileExtension: string): Promise<HttpResponse> {
        let body = {
            action: 'execute',
            code: code,
            toolchain: {
                id: 'cAutomizer',
            },
            /* eslint-disable @typescript-eslint/naming-convention */
            code_file_extension: '.' + fileExtension,
            user_settings: this.getSettingsFromFile(),
            ultimate_toolchain_xml: this.getToolchainFromFile(),
            /* eslint-enable @typescript-eslint/naming-convention */
        };

        let options = this.getCommonHttpOptions();
        options.method = 'POST';
        options.path = this.apiUrl.pathname;
        options.headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';

        return unifiedHttpsRequest(options, body);
    }

    protected getToolchainFromFile(): string {
        let defaultToolchainFile = path.join(__dirname, 'assets', 'default_toolchain.xml');
        let toolchain = fs.readFileSync(defaultToolchainFile).toString();
        if (
            fs.existsSync(this.toolchainFilePath.fsPath) &&
            fs.lstatSync(this.settingsFilePath.fsPath).isFile()
        ) {
            toolchain = fs.readFileSync(this.toolchainFilePath.fsPath).toString();
        }
        return toolchain;
    }

    protected getSettingsFromFile(): string {
        let defaultSettingsFile = path.join(__dirname, 'assets', 'default_settings.json');
        let settings = fs.readFileSync(defaultSettingsFile).toString();
        if (
            fs.existsSync(this.settingsFilePath.fsPath) &&
            fs.lstatSync(this.settingsFilePath.fsPath).isFile()
        ) {
            settings = fs.readFileSync(this.settingsFilePath.fsPath).toString();
        }
        return settings;
    }

    private parseResponse(httpResponse: HttpResponse): void {
        let response = JSON.parse(httpResponse.body);
        this.results = response.results ? response.results : [];
        this.requestId = response.requestId;
        this.error = response.error;
    }

    private delay(ms: number): Promise<any> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    private pollResults(): Promise<HttpResponse> {
        let options = this.getCommonHttpOptions();
        options.path = this.apiUrl.pathname + '/job/get/' + this.requestId;

        return unifiedHttpsRequest(options).then((httpResponse): any => {
            let response = JSON.parse(httpResponse.body);
            switch (response.status.toLowerCase()) {
                case 'done':
                    this.results = response.results;
                    Promise.resolve(response);
                    break;
                case 'error':
                    Promise.reject(response.error);
                    break;
                default:
                    // repeat polling recursively at given timeouts
                    return this.delay(this.refreshTimeInMilliseconds).then(() =>
                        this.pollResults()
                    );
            }
        });
    }

    protected printResultsToOutput(): void {
        if (this.error) {
            this.outputChannel.appendLine(this.error);
        }
        this.results.forEach((result) => {
            this.outputChannel.appendLine(`${result.logLvl}: ${result.shortDesc}`);
            this.outputChannel.appendLine(`${result.longDesc}`);
            this.outputChannel.appendLine('');
        });
    }

    protected printResultsToLog(): void {
        if (this.error) {
            this.log(this.error, vscode.DiagnosticSeverity.Error);
        }
        this.results.forEach((result) => {
            let message = `${result.shortDesc}: ${result.longDesc}`;
            let severity = this.convertSeverity(result.logLvl);
            this.log(message, severity);
        });
    }

    protected stopUltimate(): void {
        let options = this.getCommonHttpOptions();
        options.path = this.apiUrl.pathname + '/job/delete/' + this.requestId;

        unifiedHttpsRequest(options).then((httpResponse): any => {
            let response = JSON.parse(httpResponse.body);
            switch (response.status.toLowerCase()) {
                case 'done':
                    this.results = response.results;
                    this.outputChannel.appendLine('Fetching Ultimate results stopped.');
                    break;
                case 'error':
                    this.outputChannel.appendLine(
                        'An error occured, fetching Ultimate results could not be stopped.'
                    );
                    break;
                default:
                    // repeat polling recursively at given timeouts
                    return this.delay(this.refreshTimeInMilliseconds).then(() =>
                        this.pollResults()
                    );
            }
        });
    }

    protected prepareDiagnosticInfo(document: vscode.TextDocument): vscode.Diagnostic[] {
        let diagnostics: vscode.Diagnostic[] = [];

        this.results.forEach((result) => {
            if (this.resultIsWorthEmbedding(result)) {
                let relatedInformation: vscode.DiagnosticRelatedInformation[] = [];
                let reasonInformation = RegExp(/Reason: (\D*)(\d*)(.*)\n/).exec(result.longDesc);

                if (reasonInformation) {
                    let relatedLine = Number(reasonInformation[2]);
                    let relatedInfoRange = document.lineAt(relatedLine - 1).range;
                    let relatedInfoLocation = new vscode.Location(document.uri, relatedInfoRange);
                    relatedInformation.push(
                        new vscode.DiagnosticRelatedInformation(
                            relatedInfoLocation,
                            result.longDesc
                        )
                    );
                }

                diagnostics.push({
                    code: '',
                    message: result.shortDesc,
                    range: this.getResultRange(result, document),
                    severity: this.convertSeverity(result.logLvl),
                    source: 'Ultimate Automizer',
                    relatedInformation: relatedInformation,
                });
            }
        });
        return diagnostics;
    }

    private getResultRange(
        result: SingleUltimateResult,
        document: vscode.TextDocument
    ): vscode.Range {
        let startLNr = result.startLNr > 0 ? result.startLNr - 1 : 0;
        let endLNr = result.endLNr > 0 ? result.endLNr - 1 : 0;
        let assertFinding: RegExpExecArray | null = null;
        let startCol = 0;
        let endCol = 0;

        if (startLNr > 0) {
            assertFinding = RegExp(/assert(.*);/).exec(document.lineAt(startLNr).text);
        }

        if (result.startCol >= 0 && result.endCol >= 0) {
            // Use column information from Ultimate if available
            startCol = result.startCol;
            endCol = result.endCol;
        } else if (assertFinding) {
            // Try to detect the columns from the file as fallback if no proper information came
            // back from Ultimate.
            startCol = assertFinding.index;
            endCol = startCol + assertFinding[0].length;
        }

        return new vscode.Range(startLNr, startCol, endLNr, endCol);
    }

    private resultIsWorthEmbedding(result: SingleUltimateResult): boolean {
        return true; //!(result.type === 'invariant' || result.type === 'syntaxError');
    }

    private getCommonHttpOptions() {
        let defaultPort = this.apiUrl.protocol === 'http:' ? 80 : 443;
        let headers: any = {
            /* eslint-disable @typescript-eslint/naming-convention */
            Accept: '*/*',
            Connection: 'keep-alive',
            /* eslint-enable @typescript-eslint/naming-convention */
        };
        let options = {
            protocol: this.apiUrl.protocol,
            hostname: this.apiUrl.hostname,
            port: this.apiUrl.port || defaultPort,
            path: this.apiUrl.pathname,
            method: 'GET',
            headers: headers,
        };
        return options;
    }
}
