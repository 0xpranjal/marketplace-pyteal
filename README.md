# intro-to-pyteal

### Install brew
```
cd /opt
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
export PATH=/opt/homebrew/bin:$PATH
export PATH=/opt/homebrew/sbin:$PATH
```

### Instalar python 3
`brew install python3`

## Instalar nodejs
`brew install node`

## Instalar sandbox
`git clone https://github.com/algorand/sandbox.git`

## changes in configuration for running sandbox within a propject folder
```
volumes:
- type: bind
  source: ../
  target: /data
```

## Intialising sandbox
`./sandbox up -v`
`./sandbox enter algod`

