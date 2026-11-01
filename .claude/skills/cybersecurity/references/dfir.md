# Digital Forensics & Incident Response (DFIR)

## IR Lifecycle (NIST SP 800-61)

```
1. PREPARATION → Policies, tools, playbooks, training
2. DETECTION & ANALYSIS → Identify IOCs, triage, scope
3. CONTAINMENT → Short-term + long-term isolation
4. ERADICATION → Remove threat, patch root cause
5. RECOVERY → Restore systems, monitor
6. POST-INCIDENT → Lessons learned, improve
```

---

## Triage — First 30 Minutes

### Windows Live Triage
```powershell
# Running processes + network connections
Get-Process | Select Name,Id,Path | Export-Csv processes.csv
netstat -anob > netstat.txt
Get-NetTCPConnection | Where State -eq Established

# Recent logins
Get-EventLog Security -Newest 500 | Where EventID -in 4624,4625,4634 | Export-Csv logins.csv

# Scheduled tasks (common persistence)
Get-ScheduledTask | Where State -eq Ready | Select TaskName,TaskPath | Export-Csv tasks.csv
schtasks /query /fo csv /v > schtasks_verbose.csv

# Services with suspicious binaries
Get-WmiObject Win32_Service | Select Name,PathName,StartMode | Export-Csv services.csv

# Autoruns (Sysinternals)
autorunsc64.exe -a * -c -h -s > autoruns.csv

# Users and groups
Get-LocalGroupMember Administrators
Get-WmiObject Win32_UserAccount | Select Name,Disabled,LocalAccount

# Prefetch (program execution)
ls C:\Windows\Prefetch\ | sort LastWriteTime -Descending | select -first 20
```

### Linux Live Triage
```bash
# Capture volatile data FIRST (before anything else)
date; hostname; uname -a > triage.txt
ps auxf >> triage.txt
netstat -antp >> triage.txt  # or ss -antp
who; w; last -n 50 >> triage.txt
crontab -l; ls -la /etc/cron* >> triage.txt

# Persistence locations
cat /etc/rc.local
ls -la /etc/init.d/
ls -la ~/.ssh/authorized_keys
cat /etc/sudoers
find / -perm -4000 -type f 2>/dev/null  # SUID

# Recently modified files (last 24h)
find / -mtime -1 -type f 2>/dev/null | grep -v /proc | grep -v /sys

# Loaded kernel modules
lsmod | grep -v "^Module"

# Hidden files
find / -name ".*" -type f 2>/dev/null | grep -v "/.git/"
```

---

## Log Analysis

### Windows Event IDs — Critical for IR

| Event ID | Description | IR Relevance |
|----------|-------------|--------------|
| 4624 | Successful logon | Type 3 = network, Type 10 = remote interactive |
| 4625 | Failed logon | Brute force detection |
| 4648 | Logon with explicit creds | Pass-the-hash, runas |
| 4672 | Special privileges assigned | Admin logon |
| 4698 | Scheduled task created | Persistence |
| 4720 | User account created | Persistence |
| 7045 | Service installed | Persistence/malware install |
| 4688 | Process creation | Requires audit policy enabled |
| 4663 | File access | Requires SACL/object access audit |
| 1102 | Audit log cleared | Attacker covering tracks |
| 4104 | PowerShell script block | Malicious PS execution |

```powershell
# PowerShell: hunt for suspicious commands in PS logs
Get-WinEvent -LogName "Microsoft-Windows-PowerShell/Operational" | 
  Where-Object { $_.Message -match "Invoke-Expression|IEX|DownloadString|EncodedCommand|bypass" } |
  Select TimeCreated,Message | Export-Csv suspicious_ps.csv
```

### Sysmon Events (if deployed)
```
Event 1  → Process Create (includes commandline + hashes)
Event 3  → Network Connection
Event 7  → Image Loaded (DLL loading)
Event 8  → CreateRemoteThread (process injection)
Event 10 → ProcessAccess (credential dumping via LSASS)
Event 11 → FileCreate
Event 13 → RegistryValue Set
Event 22 → DNS Query
```

### Linux Log Locations
```bash
/var/log/auth.log       # SSH, sudo, PAM
/var/log/syslog         # General system
/var/log/apache2/       # Web server
/var/log/nginx/
/var/log/audit/audit.log # auditd (if enabled)
~/.bash_history          # User commands (may be tampered)

# Hunt for SSH brute force
grep "Failed password" /var/log/auth.log | awk '{print $11}' | sort | uniq -c | sort -rn

# Successful logins
grep "Accepted password\|Accepted publickey" /var/log/auth.log
```

---

## Memory Forensics (Volatility 3)

```bash
# Install
pip3 install volatility3

# Basic info
vol -f memory.dmp windows.info

# Running processes (detect hidden via malfind)
vol -f memory.dmp windows.pslist
vol -f memory.dmp windows.pstree
vol -f memory.dmp windows.psscan      # catches hidden/unlinked processes

# Network connections
vol -f memory.dmp windows.netstat

# Command line history
vol -f memory.dmp windows.cmdline
vol -f memory.dmp windows.consoles    # full console output

# Injected code detection
vol -f memory.dmp windows.malfind     # find injected code/PE headers in memory

# Dump suspicious process
vol -f memory.dmp windows.dumpfiles --pid <PID> --output-dir ./dumps/

# Extract hashes
vol -f memory.dmp windows.hashdump

# Detect rootkits
vol -f memory.dmp windows.ssdt        # SSDT hooks
vol -f memory.dmp windows.driverirp   # IRP hooks
```

---

## Malware Analysis Quick Guide

### Static Analysis
```bash
# File identification
file malware.bin
xxd malware.bin | head -20          # Magic bytes
strings -n 8 malware.bin | less     # Extract strings

# PE analysis
pe-sieve.exe /pid <PID>             # detect PE injection
pestudio malware.exe                # PE header analysis
CFF Explorer

# Hash lookup
sha256sum malware.bin
# Submit to VirusTotal, MalwareBazaar, Any.run, Hybrid Analysis
```

### Dynamic Analysis (Sandbox)
```
Tools: Cuckoo, Any.run, Hybrid Analysis, Joe Sandbox
Observe:
- File system changes (creation, modification, deletion)
- Registry modifications (persistence keys)
- Network activity (C2 beaconing, DNS queries)
- Process creation (child processes, injection targets)
- API calls (process injection, credential access)

Key MITRE ATT&CK categories to map:
T1059 - Command execution
T1055 - Process injection  
T1547 - Boot/autostart persistence
T1071 - C2 communication
T1003 - Credential dumping
```

### C2 Indicators
```bash
# Network IOCs from sandbox
- Beaconing interval (every X seconds/minutes)
- JA3/JA3S fingerprint (TLS client/server hello)
- HTTP User-Agent anomalies
- Domain generation algorithm (DGA) patterns
- DNS-over-HTTPS or DNS TXT tunneling

# Extract JA3 from PCAP
zeek -r capture.pcap /opt/zeek/share/zeek/policy/protocols/ssl/ja3.zeek
```

---

## Containment Strategies

```bash
# Network isolation (Windows)
netsh advfirewall set allprofiles state on
netsh advfirewall firewall add rule name="Block All Out" dir=out action=block
netsh advfirewall firewall add rule name="Allow IR Team" dir=out action=allow remoteip=<IR_IP>

# Isolate in EDR
# CrowdStrike: Network Contain Host
# Carbon Black: Isolate Device
# Defender for Endpoint: Isolate device from portal

# Preserve memory before shutdown
# Use winpmem, avml (Linux), or EDR's memory acquisition
winpmem_mini_x64.exe memory.dmp
```
