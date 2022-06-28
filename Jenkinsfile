def kubernetes_config = """
apiVersion: v1
kind: Pod
spec:
  containers:
  - name: node
    image: node:12-alpine
    tty: true
    resources:
      limits:
        memory: "2Gi"
        cpu: "1"
      requests:
        memory: "2Gi"
        cpu: "1"
    command:
    - cat
    volumeMounts:
    - mountPath: "/home/jenkins"
      name: "jenkins-home"
      readOnly: false
    - mountPath: "/.yarn"
      name: "yarn-global"
      readOnly: false
    - name: global-cache
      mountPath: /.cache     
    - name: global-npm
      mountPath: /.npm      
  volumes:
  - name: "jenkins-home"
    emptyDir: {}
  - name: "yarn-global"
    emptyDir: {}
  - name: global-cache
    emptyDir: {}
  - name: global-npm
    emptyDir: {}
"""

pipeline {
    agent {
        kubernetes {
            label 'emfcloud-agent-pod'
            yaml kubernetes_config
        }
    }
    
    options {
        buildDiscarder logRotator(numToKeepStr: '15')
    }
    
    environment {
        YARN_CACHE_FOLDER = "${env.WORKSPACE}/yarn-cache"
        SPAWN_WRAP_SHIM_ROOT = "${env.WORKSPACE}"
    }

    stages {
        stage('Build') {
            steps {
                container('node') {
                    timeout(30) {
                        sh "rm -rf ${YARN_CACHE_FOLDER}"
                        sh "yarn --ignore-engines --unsafe-perm"
                    }
                }
            }
        }

        stage('Codechecks ESLint') {
            steps {
                container('node') {
                    timeout(30) {
                        sh "yarn lint -o eslint.xml -f checkstyle"
                    }
                }
            }
        }

        stage('Run tests') {
            steps {
                container('node') {
                    timeout(30) {
                        sh "yarn test:ci"
                    }
                }
            }
        }

        stage('Deploy (main only)') {
            when { branch 'main' }
            steps {
                build job: 'deploy-modelserver-node-npm', wait: false
            }
        }
    }

    post {
        always {
            // Record & publish ESLint issues
            recordIssues enabledForFailure: true, publishAllIssues: true, aggregatingResults: true, 
            tools: [esLint(pattern: 'node_modules/**/*/eslint.xml')], 
            qualityGates: [[threshold: 1, type: 'TOTAL', unstable: true]]

            withChecks('Tests') {
                junit 'node_modules/**/mocha-jenkins-report.xml'
            }
        }
    }
}
