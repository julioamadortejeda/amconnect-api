-- FK de agents.promo_code_used → promo_codes(code)
alter table agents
  add constraint fk_agents_promo_code
  foreign key (promo_code_used) references promo_codes(code)
  on update cascade;  -- si el código cambia, se actualiza en agents también
