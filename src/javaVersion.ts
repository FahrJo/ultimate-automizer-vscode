import * as util from 'util';
import * as cp from 'child_process';
import * as os from 'os';

const exec = util.promisify(cp.exec);

interface ExecResponse {
    stdout: string;
    stderr: string;
}

export function getJavaVersion(): Promise<string> {
    return exec('java -version').then((data: ExecResponse) => parseJavaVersionResponse(data));
}

function parseJavaVersionResponse(data: ExecResponse): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        let stderr = data.stderr.toString().split('\n')[0];
        let javaVersion = /(java|openjdk) version/.test(stderr)
            ? stderr.split(' ')[2].replace(/"/g, '')
            : false;
        if (javaVersion) {
            // We have Java installed
            resolve(javaVersion);
        } else {
            reject(new Error(`No Java installed`));
        }
    });
}

export function getJavaHomeForJava(version: string | number): Promise<string> {
    let func = getJavaHomeReject;

    switch (os.platform()) {
        case 'darwin':
            func = getJavaHomeDarwin;
            break;
        case 'linux':
            func = getJavaHomeReject;
            break;
        case 'win32':
            func = getJavaHomeReject;
            break;
        default:
            break;
    }

    return func(version);
}

function setJavaVersionDarwin(version: number | string): Promise<void> {
    return exec(`export JAVA_HOME=$(/usr/libexec/java_home -v ${version} -V)`).then(
        (data: ExecResponse) => console.log(data)
    );
}

function getJavaHomeDarwin(version: number | string): Promise<string> {
    return exec(`/usr/libexec/java_home -v ${version} -V`).then((data: ExecResponse) =>
        Promise.resolve(data.stdout)
    );
}

function getJavaHomeReject(version: number | string): Promise<string> {
    return Promise.reject(new Error(`Required Java version could not be set. please try manually`));
}
