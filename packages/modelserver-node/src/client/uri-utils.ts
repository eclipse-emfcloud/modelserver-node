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
export function validateModelURI(modeluri?: string): URI {
    if (!modeluri || modeluri === '') {
        throw new Error('Model URI parameter is absent or empty.');
    }
    const modelURIParts = URI.parse(modeluri);
    // Java Model Server does not deal correctly with full absolute file path
    const modelURI = new URI(modelURIParts).protocol('');
    return modelURI;
}
