from django.contrib import admin

from .models import Grant, GrantBudgetLine, GrantDisbursement, GrantExpenditure


class GrantBudgetLineInline(admin.TabularInline):
    model = GrantBudgetLine
    extra = 0


@admin.register(Grant)
class GrantAdmin(admin.ModelAdmin):
    list_display = ("id", "code", "organization", "project", "total_amount", "currency", "status")
    list_filter = ("status", "currency", "project")
    search_fields = ("code", "title", "organization__name")
    inlines = [GrantBudgetLineInline]


@admin.register(GrantDisbursement)
class GrantDisbursementAdmin(admin.ModelAdmin):
    list_display = ("id", "grant", "date", "tranche", "amount")
    list_filter = ("date",)


@admin.register(GrantExpenditure)
class GrantExpenditureAdmin(admin.ModelAdmin):
    list_display = ("id", "grant", "date", "category", "amount")
    list_filter = ("date", "category")
