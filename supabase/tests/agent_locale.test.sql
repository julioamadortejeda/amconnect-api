-- D-024: agents.locale solo admite null, 'es' o 'en'.
-- Correr con: supabase test db
begin;
select plan(5);

insert into auth.users (id, email, raw_user_meta_data)
values ('33333333-3333-3333-3333-333333333333', 'locale@test.local', '{"full_name":"Locale"}');

select lives_ok($$update agents set locale = 'es' where id = '33333333-3333-3333-3333-333333333333'$$, 'es es valido');
select lives_ok($$update agents set locale = 'en' where id = '33333333-3333-3333-3333-333333333333'$$, 'en es valido');
select lives_ok($$update agents set locale = null where id = '33333333-3333-3333-3333-333333333333'$$, 'null es valido');
select throws_ok($$update agents set locale = 'en_US' where id = '33333333-3333-3333-3333-333333333333'$$, '23514', null, 'en_US se rechaza');
select throws_ok($$update agents set locale = 'es-MX' where id = '33333333-3333-3333-3333-333333333333'$$, '23514', null, 'es-MX se rechaza');

select * from finish();
rollback;
