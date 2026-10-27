Cek status backend UINSGD di stack Docker lokal (`deploy/local/docker-compose.backend.yml`).

!docker ps --filter label=uinsgd.group=backend --format "{{.Names}}	{{.Status}}	{{.Ports}}" 2>/dev/null || echo "DOCKER_DOWN"
!for p in 5000:master 5001:damba 5002:bank 5003:ppid 5005:sarpras 5006:beasiswa 5007:cbt 5008:lms 5009:sipukt; do n=${p#*:}; c=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://localhost:${p%%:*}/health); echo "$n $c"; done

Berdasarkan hasil di atas:
- Tampilkan ringkasan container (healthy/unhealthy) dan kode HTTP /health per modul.
- Untuk container bermasalah, tawarkan: `docker logs <nama> --tail 50`, atau recreate lewat compose
  (`cd deploy/local && bash prepare-env.sh && docker compose -f docker-compose.backend.yml up -d --force-recreate <service>`).
- JANGAN pakai `docker restart` untuk memuat image baru (restart tidak mengganti image) dan JANGAN `docker run` manual.
- Jangan menjalankan apa pun otomatis — tanyakan dulu ke user.
