# Eclipse EMF.cloud Node.js Model Server ![build-status](https://img.shields.io/jenkins/build?jobUrl=https://ci.eclipse.org/emfcloud/job/eclipse-emfcloud/job/modelserver-node/job/main/)

The Node.js _Model Server_ is a façade in front of the Java _Model Server_ that provides an extensible environment for Javascript-based _plug-ins_.
Plug-in contributions are supported for

- custom command providers
- validation providers
- trigger providers that add side-effects to edit requests

## Setup

Install [nvm](https://github.com/creationix/nvm#install-script).
Note that `0.36` may not be the latest version, so check that first and substitute the current version in the URL.

    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.36.0/install.sh | bash

Install npm and node.

    nvm install 12.18.4
    nvm use 12.18.4

Install yarn.

    npm install -g yarn

Install dependencies and build the _Model Server_ and related packages.

    yarn

## Run

To run the Model Server example that demonstrates customization plug-ins:

    yarn start

The server will listen for incoming requests on port 8082 and will connect to the _Upstream Model Server_ on port 8081 on the local host.
This upstream server must be started separately; see the [EMF.Cloud Java Model Server](https://github.com/eclipse-emfcloud/emfcloud-modelserver) project for details.

For verbose logging output, run it so:

    yarn start -v

For information about other options:

    yarn start --help

## License

This program and the accompanying materials are made available under the
terms of the Eclipse Public License v. 2.0 which is available at
<https://www.eclipse.org/legal/epl-2.0>.

This Source Code may also be made available under the following Secondary
Licenses when the conditions for such availability set forth in the Eclipse
Public License v. 2.0 are satisfied: MIT.

SPDX-License-Identifier: EPL-2.0 OR MIT
