-- Fjerner testkontoen, der blev oprettet under et tjek af siden.
delete from "user" where lower(email) = 'check@banditboard.dk';
