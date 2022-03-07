export { default as HealthProbe } from './HealthProbe'
export { default as Container } from './container'
export { default as PodVolume } from './pod_volume'
export { default as PodNetwork } from './pod_network'
export { default as PodAffinity } from './pod_affinity'
export { default as PodSecurity } from './pod_security'
export { default as Workload } from './workload'
export { default as Service } from './service'
export { default as ConfigMap } from './configmap'
export { default as Secret } from './secret'

export function kindTemplate(kind) {
  if(kind == 'Workload') return workloadTemplate()
  else if(kind == 'Service') return serviceTemplate()
  else if(kind == 'ConfigMap') return configMapTemplate()
  else if(kind == 'Secret') return secretTemplate()
}

export function transferTemplate(template, appName) {
  let tpl = JSON.parse(JSON.stringify(template))

  if(!tpl) return {err: "应用资源为空"}
  if(!tpl.kind) return {err: "应用资源kind为空"}
  if(!tpl.metadata) return {err: "应用资源metadata为空"}
  if(!tpl.metadata.name) return {err: "应用资源名称为空"}

  tpl.metadata.labels['kubespace.cn/app'] = appName

  if(['Deployment', 'StatefulSet'].indexOf(tpl.kind) > -1) return transferWorkload(tpl)
  if(tpl.kind == 'Service') return transferService(tpl)
  if(tpl.kind == 'ConfigMap') return transferConfigMap(tpl)
  if(tpl.kind == 'Secret') return transferSecret(tpl)

  return {err: `${tpl.kind}/${tpl.metadata.name}未找到对应的资源类型`}
}

function transferWorkload(tpl) {
  if(!tpl.spec.template.spec.containers || tpl.spec.template.spec.containers.length <= 0) {
    return {err: `应用资源${tpl.kind}/${tpl.metadata.name}容器为空`}
  }
  tpl.spec.selector.matchLabels['kubespace.cn/app'] = tpl.metadata.name
  tpl.spec.template.metadata.labels['kubespace.cn/app'] = tpl.metadata.name
  let err = transferContainer(tpl)
  if(err) return err
  err = transferPodVolume(tpl)
  if(err) return err
  err = transferPodNetwork(tpl)
  if(err) return err
  err = transferAffinity(tpl)
  if(err) return err
  return {tpl}
}

function transferPodNetwork(tpl) {
  if(tpl.spec.template.spec.hostAliases.length > 0) {
    for(let h of tpl.spec.template.spec.hostAliases) {
      if(!h.hostnames) return {err: `应用资源${tpl.kind}/${tpl.metadata.name}主机别名域名为空`}
      if(!h.ip) return {err: `应用资源${tpl.kind}/${tpl.metadata.name}主机别名ip为空`}
      h.hostnames = [h.hostnames]
    }
  }
}

function transferContainer(tpl) {
  let initContainers = []
  let containers = []
  let err = ''
  for(let c of tpl.spec.template.spec.containers) {
    if(!c.name) {
      return {err: `应用资源${tpl.kind}/${tpl.metadata.name}容器名称为空`}
    }
    if(!c.image) {
      return {err: `应用资源${tpl.kind}/${tpl.metadata.name}中容器镜像为空`}
    }
    let p = transferProbe(c.livenessProbe)
    if(p) {
      c.livenessProbe = p
    } else {
      delete c.livenessProbe
    }
    p = transferProbe(c.readinessProbe)
    if(p) {
      c.readinessProbe = p
    } else {
      delete c.readinessProbe
    }
    if(c.command) {
      try{
        c.command = JSON.parse(c.command)
      }catch(e){
        c.command = [c.command]
      }
    } else {
      c.command = []
    }
    if(c.args) {
      try{
        c.args = JSON.parse(c.args)
      }catch(e){
        c.args = [c.args]
      }
    } else {
      c.args = []
    }
    if(c.securityContext.runAsUser) {
      c.securityContext.runAsUser = parseInt(c.securityContext.runAsUser)
    }
    if(c.securityContext.runAsGroup) {
      c.securityContext.runAsGroup = parseInt(c.securityContext.runAsGroup)
    }
    for(let p of c.ports) {
      if(!p.containerPort) {
        return {err: `应用资源${tpl.kind}/${tpl.metadata.name}容器端口为空`}
      }
      try{
        p.containerPort = parseInt(p.containerPort)
      } catch(e) {
        return {err: `应用资源${tpl.kind}/${tpl.metadata.name}容器端口${p.containerPort}错误`}
      }
    }
    err = transferEnv(c)
    if(err) return {err: `应用资源${tpl.kind}/${tpl.metadata.name}容器${err}`}
    if(c.init){
      initContainers.push(c)
    } else {
      containers.push(c)
    }
    delete c.init
  }
  tpl.spec.template.spec.containers = containers
  tpl.spec.template.spec.initContainers = initContainers
}

function transferProbe(probe) {
  if(!probe.probe) return 
  let obj = {
    successThreshold: probe.successThreshold, 
    failureThreshold: probe.failureThreshold,
    initialDelaySeconds: probe.initialDelaySeconds, 
    timeoutSeconds: probe.timeoutSeconds, 
    periodSeconds: probe.periodSeconds
  } 
  if(probe.type == 'http' || probe.type == 'https') {
    obj['httpGet'] = {
      path: obj.handle.path,
      port: obj.handle.port,
      scheme: 'HTTP'
    }
    if(probe.type == 'https') obj.httpGet.scheme = 'HTTPS'
  }
  if(probe.type == 'cmd') {
    obj['exec'] = {
      command: probe.handle.command
    }
  }
  if(probe.type == 'tcp') {
    obj['tcpSocket'] = {
      port: probe.handle.command
    }
  }
  return obj
}

function transferEnv(c) {
  let envs = []
  for(let e of c.env) {
    if(!e.name) {
      return '环境变量名称为空'
    }
    if(e.type == 'value') {
      envs.push({
        name: e.name,
        value: e.value
      })
    } else if(e.type == 'configMap') {
      envs.push({
        name: e.name,
        valueFrom: {
          configMapKeyRef: {
            name: e.value.name,
            key: e.key,
          }
        }
      })
    } else if(e.type == 'secret') {
      envs.push({
        name: e.name,
        valueFrom: {
          secretKeyRef: {
            name: e.value.name,
            key: e.key
          }
        }
      })
    } else if(e.type == 'field') {
      envs.push({
        name: e.name,
        valueFrom: {
          fieldRef: {
            fieldPath: e.value
          }
        }
      })
    } else if(e.type == 'resource') {
      envs.push({
        name: e.name,
        valueFrom: {
          resourceFieldRef: {
            resource: e.value
          }
        }
      })
    }
  }
  c.env = envs
}

function transferPodVolume(tpl) {
  let vols = []
  for(let v of tpl.spec.template.spec.volumes) {
    if(!v.name) return {err: `应用资源${tpl.kind}/${tpl.metadata.name}中存储卷名称为空`}
    let vol = {
      name: v.name
    }
    if(v.type == 'configMap' || v.type == 'secret') {
      vol[v.type] = {
        items: v[v.type].items,
      }
      if(v[v.type].defaultMode) {
        vol[v.type].defaultMode = parseInt(v[v.type].defaultMode, 8)
      }
      if(v.type == 'configMap') {
        vol[v.type]['name'] = v[v.type].obj.metadata.name
      } else {
        vol[v.type]['secretName'] = v[v.type].obj.metadata.name
      }
    } else {
      vol[v.type] = v[v.type]
    }
    vols.push(vol)
  }
  if(vols.length > 0) tpl.spec.template.spec.volumes = vols
}

function transferAffinity(tpl) {
  let podSpec = tpl.spec.template.spec
  if(podSpec.nodeSelector.length > 0) {
    let ns = {}
    for(let s of podSpec.nodeSelector) {
      ns[s.key] = s.value
    }
    podSpec.nodeSelector = ns
  } else {
    podSpec.nodeSelector = {}
  }
  let affinity = tpl.spec.template.spec.affinity
  if(affinity.nodeAffinity.length == 0) affinity.nodeAffinity = {}
  if(affinity.podAffinity.length == 0) affinity.podAffinity = {}
  if(affinity.podAntiAffinity.length == 0) affinity.podAntiAffinity = {}
}

export function newPodVolume() {
  return {
    name: '',
    type: 'persistentVolumeClaim',
    persistentVolumeClaim: {},
    glusterfs: {},
    nfs: {},
    secret: {items: [], obj: {keys: []}},
    configMap: {items: [], obj: {keys: []}},
    emptyDir: {},
    hostPath: {}
  }
}

export function newContainer() {
  return {
    init: false,
    name: '',
    image: '',
    command: '',
    args: '',
    workingDir: '',
    ports: [],
    env: [],
    resources: {limits: {}, requests: {}},
    livenessProbe: {probe: false, type: 'http', handle: {}, successThreshold: 1, failureThreshold: 3,
                    initialDelaySeconds: 0, timeoutSeconds: 1, periodSeconds: 10},
    readinessProbe: {probe: false, type: 'http', handle: {}, successThreshold: 1, failureThreshold: 3,
                    initialDelaySeconds: 0, timeoutSeconds: 1, periodSeconds: 10},
    imagePullPolicy: '',
    volumeMounts: [],
    stdin: false,
    tty: false,
    securityContext: {seLinuxOptions: {}, capabilities: {add: [], drop: []}},
  }
}

function workloadTemplate() {
  return {
    kind: "Deployment",
    apiVersion: "apps/v1",
    metadata: {
      name: "",
      labels: {},
      namespace: "{{ .Release.Namespace }}"
    },
    spec: {
      replicas: 1,
      selector: {
        matchLabels: {}
      },
      template: {
        metadata: {
          labels: {}
        },
        spec: {
          nodeSelector: [],
          tolerations: [],
          affinity: {nodeAffinity: [], podAffinity: [], podAntiAffinity: []},
          securityContext: {sysctls: [], seLinuxOptions: {}},
          hostAliases: [],
          containers: [newContainer()],
          volumes: [],
        }
      }
    }
  }
}

function serviceTemplate() {
  return {
    kind: "Service",
    apiVersion: "v1",
    metadata: {
      name: "",
      labels: {},
      namespace: "{{ .Release.Namespace }}"
    },
    spec: {
      ports: [],
      selector: {},
      type: 'ClusterIP',
    }
  }
}

function transferService(tpl) {
  for(let p of tpl.spec.ports) {
    if(!p.port) {
      return {err: `应用资源${tpl.kind}/${tpl.metadata.name}服务端口为空`}
    }
    try{
      p.port = parseInt(p.port)
    } catch(e) {
      return {err: `应用资源${tpl.kind}/${tpl.metadata.name}服务端口${p.port}错误`}
    }
    if(!p.targetPort) {
      return {err: `应用资源${tpl.kind}/${tpl.metadata.name}容器端口为空`}
    }
    try{
      p.targetPort = parseInt(p.targetPort)
    } catch(e) {
      return {err: `应用资源${tpl.kind}/${tpl.metadata.name}容器端口${p.targetPort}错误`}
    }
    if(tpl.spec.type == 'NodePort' && p.nodePort) {
      try{
        p.nodePort = parseInt(p.nodePort)
      } catch(e) {
        return {err: `应用资源${tpl.kind}/${tpl.metadata.name} nodePort ${p.targetPort}错误`}
      }
    }
  }
  return {tpl}
}

function configMapTemplate() {
  return {
    kind: "ConfigMap",
    apiVersion: "v1",
    metadata: {
      name: "",
      labels: {},
      namespace: "{{ .Release.Namespace }}"
    },
    data: []
  }
}

function transferConfigMap(tpl) {
  let data = {}
  for(let d of tpl.data) {
    if(!d.key){
      return {err: `应用资源${tpl.kind}/${tpl.metadata.name}配置项key为空`}
    }
    data[d.key] = d.value
  }
  tpl.data = data
  return {tpl}
}

function resolveConfigMap(tpl) {
  let data = []
  for(let k in tpl.data) {
    data.push({key: k, value: tpl.data[k]})
  }
  tpl.data = data
}

function secretTemplate() {
  return {
    kind: "Secret",
    apiVersion: "v1",
    metadata: {
      name: "",
      labels: {},
      namespace: "{{ .Release.Namespace }}"
    },
    data: [],
    tls: {},
    userPass: {},
    imagePass: {},
    type: 'Opaque'
  }
}

function transferSecret(tpl) {
  let data = {}
  if(tpl.type == 'Opaque') {
    for(let d of tpl.data) {
      if(!d.key){
        return {err: `应用资源${tpl.kind}/${tpl.metadata.name}配置项key为空`}
      }
      data[d.key] = btoa(encodeURIComponent(d.value))
    }
    tpl.data = data
  } else if(tpl.type == 'kubernetes.io/tls') {
    tpl.data = {
      'tls.crt': btoa(encodeURIComponent(tpl.tls['crt'])),
      'tls.key': btoa(encodeURIComponent(tpl.tls['key']))
    }
  } else if(tpl.type == 'kubernetes.io/basic-auth') {
    tpl.data = {
      'username': btoa(encodeURIComponent(tpl.userPass['username'])),
      'password': btoa(encodeURIComponent(tpl.userPass['password']))
    }
  } else if(tpl.type == 'kubernetes.io/dockerconfigjson') {
    if(!tpl.imagePass.url) {
      return {err: `应用资源${tpl.kind}/${tpl.metadata.name}镜像仓库地址为空`}
    }
    let auth = {auths: {}}
    auth.auths[tpl.imagePass.url] = {
      'username': tpl.imagePass.username,
      'password': tpl.imagePass.password,
      'email': tpl.imagePass.email,
      'auth': btoa(encodeURIComponent(`${tpl.imagePass.username}: ${tpl.imagePass.password}`))
    }
    tpl.data = {
      '.dockerconfigjson': btoa(encodeURIComponent(JSON.stringify(auth)))
    }
  }
  delete tpl.tls
  delete tls.userPass
  delete tls.imagePass
  return {tpl}
}

function resolveSecret(tpl) {
  tpl.tls = {}
  tpl.userPass = {}
  tpl.imagePass = {}
  let data = []
  if(tpl.type == 'Opaque') {
    for(let k in tpl.data) {
      data.push({key: k, value: decodeURIComponent(atob(tpl.data[k]))})
    }
  } else if(tpl.type == 'kubernetes.io/tls') {
    tpl.tls['crt'] = decodeURIComponent(atob(tpl.data['tls.crt']))
    tpl.tls['key'] = decodeURIComponent(atob(tpl.data['tls.key']))
  }  else if(tpl.type == 'kubernetes.io/basic-auth') {
    tpl.userPass['username'] = decodeURIComponent(atob(tpl.data['username']))
    tpl.userPass['password'] = decodeURIComponent(atob(tpl.data['password']))
  } else if(tpl.type == 'kubernetes.io/dockerconfigjson') {
    let auths = JSON.parse(decodeURIComponent(atob(tpl.data['.dockerconfigjson'])))
    for(let k in auths.auths) {
      tpl.imagePass = {
        url: k,
        username: auths.auths[k].username,
        password: auths.auths[k].password,
        email: auths.auths[k].email
      }
    }
  }
  tpl.data = data
}

export function resolveToTemplate(template) {
  if(['Deployment', 'StatefulSet', 'DaemonSet', 'CronJob', 'Job'].indexOf(template.kind) >= 0){
    resolveWorkload(template)
  }
  else if(template.kind == 'ConfigMap') resolveConfigMap(template)
  else if(template.kind == 'Secret') resolveSecret(template)
}

function resolveWorkload(tpl) {
  resolveContainers(tpl)
  resolveAffinity(tpl)
  let podSpec = tpl.spec.template.spec
  if(!podSpec.hostAliases) {
    podSpec.hostAliases = []
  }
  if(!podSpec.securityContext) {
    podSpec.securityContext = {sysctls: [], seLinuxOptions: {}}
  }
}

function resolveContainers(tpl) {
  let podSpec = tpl.spec.template.spec
  if(podSpec.initContainers) {
    for(let c of podSpec.initContainers) {
      c.init = true
      resolveContainer(c)
      podSpec.containers.push(c)
    }
  }
  for(let c of podSpec.containers) {
    resolveContainer(c)
  }
  
}

function resolveContainer(c) {
  c.livenessProbe = resolveProbe(c.livenessProbe)
  c.readinessProbe = resolveProbe(c.readinessProbe)
  if(c.command && c.command.length > 0) c.command = JSON.stringify(c.command)
  else c.command = ''
  if(c.args && c.args.length > 0) c.args = JSON.stringify(c.args)
  else c.args = ''
}

function resolveProbe(probe) {
  if(!probe) return {probe: false, type: 'http', handle: {}, successThreshold: 1, failureThreshold: 3,
  initialDelaySeconds: 0, timeoutSeconds: 1, periodSeconds: 10}
  probe.probe = true
  if('httpGet' in probe) {
    probe.type = 'http'
    if(probe.httpGet.scheme == 'HTTPS') probe.type = 'https'
    probe.handle = probe.httpGet
    delete probe.httpGet
  } else if('tcpSocket' in probe) {
    probe.type = 'tcp'
    probe.handle = probe.tcpSocket
    delete probe.tcpSocket
  } else if('exec' in probe) {
    probe.type = 'command'
    probe.handle = probe.exec
    delete probe.exec
  }
  return probe
}

function resolveAffinity(tpl) {
  let podSpec = tpl.spec.template.spec
  podSpec.affinity = {nodeAffinity: [], podAffinity: [], podAntiAffinity: []}
  if(podSpec.nodeSelector) {
    let ns = []
    for(let k in podSpec.nodeSelector) {
      ns.push([{key: k, values: podSpec.nodeSelector[k]}])
    }
    podSpec.nodeSelector = ns
  } else {
    podSpec.nodeSelector = []
  }
  if(!podSpec.tolerations) podSpec.tolerations = []
}