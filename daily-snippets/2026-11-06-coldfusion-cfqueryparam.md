# ColdFusion: siempre usa `cfqueryparam`

**Fecha:** 2026-11-06 · **Tema:** ColdFusion + SQL Server

## Problema
Concatenar variables directamente en un `cfquery` abre la puerta a **SQL Injection** y además impide que SQL Server reutilice el plan de ejecución.

```cfml
<!--- MAL --->
<cfquery name="qEmpleado" datasource="#application.dsn#">
    SELECT nombre, puesto
    FROM   Empleados
    WHERE  id_empleado = #url.id#
</cfquery>
```

## Solución
```cfml
<!--- BIEN --->
<cfquery name="qEmpleado" datasource="#application.dsn#">
    SELECT nombre, puesto
    FROM   Empleados
    WHERE  id_empleado = <cfqueryparam value="#url.id#" cfsqltype="cf_sql_integer">
      AND  estado      = <cfqueryparam value="A" cfsqltype="cf_sql_char" maxlength="1">
</cfquery>
```

## Por qué funciona
- Envía el valor como **parámetro enlazado** (`?`), nunca como texto SQL.
- Valida el tipo: si `url.id` no es entero, CF lanza error antes de tocar la BD.
- SQL Server cachea el plan → consultas repetidas más rápidas.

## Tip extra
Para listas en un `IN (...)` usa `list="true"`:

```cfml
WHERE id_empleado IN (<cfqueryparam value="#form.ids#" cfsqltype="cf_sql_integer" list="true">)
```

Compatible con ColdFusion 8, 2016 y 2025.
