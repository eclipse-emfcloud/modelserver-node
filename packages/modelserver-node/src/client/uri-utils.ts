/********************************************************************************
 * Copyright (c) 2022 STMicroelectronics.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * https://www.eclipse.org/legal/epl-2.0, or the MIT License which is
 * available at https://opensource.org/licenses/MIT.
 *
 * SPDX-License-Identifier: EPL-2.0 OR MIT
 *******************************************************************************/
import * as URI from 'urijs';

/**
 * Obtain a valid modelURI from the given `modeluri` query parameter.
 *
 * @param modeluri a modeluri string query parameter
 * @returns the transformed valid URI, throws an Error otherwise
 */
export function getValidatedModelURI(queryModelUri?: string): URI {
    if (!queryModelUri || queryModelUri === '') {
        throw new Error('Model uri parameter is absent or empty.');
    }
    if (typeof queryModelUri !== 'string') {
        throw new Error(`Incorrect query model uri parameter: ${queryModelUri}`);
    }
    return getNormalizedUri(queryModelUri);
}

/**
 * Returns the given uri string as normalized URI object
 * @param uriString the uri as string to be normalized
 * @returns the normalized URI
 */
export function getNormalizedUri(uriString: string): URI {
    return new URI(cleanWindowsPath(uriString)).normalize();
}

function cleanWindowsPath(path: string): string {
    // if the path begins with forward or backward slashes, followed by a drive letter,
    // clean the slashes from the beginning of the string as it's not a valid absolute path in Windows
    return path.replace(/^([\\/]+)([a-zA-Z]+:[\\/]+.*)/g, '$2');
}
