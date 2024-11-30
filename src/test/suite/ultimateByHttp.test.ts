import * as assert from 'assert';
import * as vscode from 'vscode';
import { UltimateByHttp } from '../../ultimateByHttp';

suite('UltimateByHttp Test Suite', () => {
    let extensionContext: vscode.ExtensionContext;

    suiteSetup(async () => {
        // Trigger extension activation and grab the context as some tests depend on it
        const extension = vscode.extensions.getExtension('FahrJo.ultimate-automizer');
        extensionContext = await extension?.activate();
    });

    test('requestOfValidFile', async () => {
        let ultimate = new UltimateByHttp(
            extensionContext,
            vscode.Uri.file(''),
            vscode.Uri.file(''),
            'https://ultimate-pa.org/api'
        );
        ultimate.runOn('');

        await new Promise((f) => setTimeout(f, 10000));

        let results = ultimate.getResultsOfLastRun()[0];
        console.log(results);
        const expectedResult = JSON.parse(
            '{"startLNr":-1,"startCol":-1,"endLNr":-1,"endCol":-1,"logLvl":"info","shortDesc":"All specifications hold","type":"positive","longDesc":"We were not able to verify any specification because the program does not contain any specification."}'
        );
        assert.deepEqual(results, expectedResult);
    }).timeout(20000);

    test('requestOfSyntaxError', async () => {
        let ultimate = new UltimateByHttp(
            extensionContext,
            vscode.Uri.file(''),
            vscode.Uri.file(''),
            'https://ultimate-pa.org/api'
        );
        ultimate.runOn('a');

        await new Promise((f) => setTimeout(f, 10000));

        let results = ultimate.getResultsOfLastRun()[0];
        console.log(results);
        const expectedResult = JSON.parse(
            '{"startLNr":-1,"startCol":0,"endLNr":0,"endCol":0,"logLvl":"error","shortDesc":"Incorrect Syntax","type":"syntaxError","longDesc":"Syntax check with command \\"gcc -std=c11 -pedantic -w -fsyntax-only\\" returned the following output. \\n1:1: error: expected \'=\', \',\', \';\', \'asm\' or \'__attribute__\' at end of input\\n    1 | a\\n      | ^"}'
        );
        assert.deepEqual(results, expectedResult);
    }).timeout(20000);
});
